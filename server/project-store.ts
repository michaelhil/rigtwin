import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROJECT_FORMAT, type ProjectDependency, type ProjectDetail, type ProjectSnapshot, type ProjectSummary, type NamedVersion, type ReleaseFiles, type ReleaseMode, type SceneLocation, type WorkspaceSummary, type WorkspaceTree } from "../shared/project.ts";
import type { RoomCatalog, RoomScene } from "../shared/room.ts";
import { newRoom, parseRoom, RoomError, type RoomRecord } from "./room-model.ts";
import { isId as isWorkspaceId } from "./names.ts";
import { LIMITS } from "./limits.ts";
import { fields, id, inspectPackage, invalid, makePackage, markdown, name, object, ProjectError, projectPins, resolvePackage } from "./project-package.ts";

interface StoredScene { portableId: string; sourceRevision: number; record: RoomRecord }
interface Location extends ProjectSummary { copiedFrom?:string; dir: string; device: number; inode: number; workspaces: string[] }
/** Projects written before workspaces existed belong to this one. */
export const DEFAULT_WORKSPACE = "00000000-0000-4000-8000-000000000001";
/** Demo scenes live here, one per browser, reset to the furnished default each time they are opened. Never listed. */
export const DEMO_WORKSPACE = "00000000-0000-4000-8000-000000000002";
const DEMO = {id:DEMO_WORKSPACE,name:"Demo"};
/** What an open public sandbox may do: navigate and create, nothing that reads or writes files outside the store. */
const PUBLIC_COMMANDS = new Set(["demo.open","workspace.create","workspace.rename","project.list","project.open","project.create","project.rename","project.scene","scene.rename"]);
const byName = (a:{name:string},b:{name:string}) => a.name.localeCompare(b.name,"en",{numeric:true});
/** "My project" when there is none yet, then the count plus one ("Project 3" beside two others), skipping names in use. */
function nextName(first:string, stem:string, used:string[]) {
  if (!used.length) return first;
  for (let i=used.length+1;;i++) if (!used.includes(stem+" "+i)) return stem+" "+i;
}
type EmbeddedRelease = { pin: string; files: ReleaseFiles };
function sameFolder(p:Location) {
  const stat=lstatSync(p.dir,{throwIfNoEntry:false});
  return stat?.isDirectory() && stat.dev===p.device && stat.ino===p.inode;
}
const reserved = new Set(["project.json","project.md","scenes","versions","dependencies","assessment.json","workspaces.json"]);
const mkdir = (dir:string) => mkdirSync(dir,{mode:0o700});
function load(file:string) {
  if (!lstatSync(file).isFile()) throw invalid("Expected a regular file at " + file);
  return readFileSync(file,"utf8");
}
function atom(file:string, content:string) {
  const tmp = join(dirname(file),".write-" + randomUUID());
  const fd = openSync(tmp,"wx",0o600);
  try {
    try { writeFileSync(fd,content); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp,file);
  } finally { rmSync(tmp,{force:true}); }
}
const write = (file:string,v:unknown) => atom(file,JSON.stringify(v));
function retainEmbedded(dir:string, dependencies:ProjectDependency[]) {
  const embedded=dependencies.flatMap(d=>d.mode==="embed"?[{pin:d.pin,files:d.files}]:[]);
  if(!embedded.length) return false;
  const file=join(dir,"dependencies","embedded.json");
  const saved:EmbeddedRelease[]=existsSync(file)?JSON.parse(load(file)):[];
  const pins=new Set(saved.map(d=>d.pin));
  const additional=embedded.filter(d=>!pins.has(d.pin));
  if(!additional.length) return false;
  write(file,[...saved,...additional]);
  return true;
}
function safeFolder(raw: unknown) {
  if (typeof raw!=="string" || raw.length>800 || raw.split("/").length>24 || raw.split("/").some(p=>
    !p || p!==p.trim() || p.startsWith(".") || p.length>120 || /[<>:"\\|?*\p{C}]/u.test(p) || reserved.has(p.toLowerCase()))) throw invalid("Choose visible folder names inside the projects directory, for example Client/Study.");
  return raw;
}
const folderLabel = (n:string) => n.replace(/[<>:"\\/|?*\p{C}]/gu,"-").replace(/^\.+/,"").trim() || "Project";
const fileIds = (dir:string) => {
  if (!lstatSync(dir).isDirectory()) throw invalid("Expected a project data directory.");
  return readdirSync(dir,{withFileTypes:true}).filter(f=>f.isFile() && f.name.endsWith(".json") && isWorkspaceId(f.name.slice(0,-5))).map(f=>f.name.slice(0,-5)).sort();
};
function source(s:StoredScene):RoomScene { return {...s.record.scene, id:s.portableId,version:s.sourceRevision}; }
const missing = (what:string) => new ProjectError("not_found","Unknown " + what + ".","Open the project and choose one of its current IDs.",404);
const conflict = (message:string,hint:string) => new ProjectError("conflict",message,hint,409);
const safeRevision = (value:unknown) => Number.isSafeInteger(value) && Number(value)>=0;
const snapshotOrder = (p:ProjectSnapshot) => ({...p,scenes:[...p.scenes].sort((a,b)=>a.id.localeCompare(b.id)),versions:[...p.versions].sort((a,b)=>a.id.localeCompare(b.id))});

export class ProjectStore {
  private root:string;
  private index = new Map<string,Location>();
  private owners = new Map<string,Location>();
  constructor(private dataDir:string, private catalog:RoomCatalog, private publish:(scene:RoomScene)=>void, private publicMode=false) {
    this.root=join(dataDir,"projects");
    if (!existsSync(this.root)) mkdir(this.root);
    this.refresh();
    // An embedded copy remains available across restarts, including files required only by saved versions.
    for (const p of this.index.values()) {
      const file=join(p.dir,"dependencies","embedded.json");
      if (!existsSync(file)) continue;
      const entries=JSON.parse(load(file));
      if (entries.length) {
        if (!catalog.transfer) throw invalid("The installation cannot resolve embedded releases from " + p.folder);
        catalog.transfer.prepare(entries).commit();
      }
    }
  }
  private refresh() {
    const projects=new Map<string,Location>(), owners=new Map<string,Location>();
    const walk=(dir:string) => {
      const stat=lstatSync(dir);
      if (!stat.isDirectory()) throw invalid("Invalid project folder.");
      const files=readdirSync(dir,{withFileTypes:true});
      if (files.some(f=>f.name==="project.json" && f.isFile())) {
        const meta=JSON.parse(load(join(dir,"project.json")));
        if (meta.format!==PROJECT_FORMAT) throw invalid("Unsupported project folder format in " + dir);
        const projectId=id(meta.id);
        if (projects.has(projectId)) throw invalid("Duplicate project folder for " + projectId + ". Use import to create a separate copy.");
        const p={...(meta.copiedFrom?{copiedFrom:id(meta.copiedFrom)}:{}),id:projectId,name:name(meta.name),workspace:meta.workspace===undefined?DEFAULT_WORKSPACE:id(meta.workspace),dir,device:stat.dev,inode:stat.ino,folder:relative(this.root,dir).split(sep).join("/"),workspaces:fileIds(join(dir,"scenes"))};
        projects.set(p.id,p);
        for(const ws of p.workspaces) {
          if(owners.has(ws)) throw invalid("Duplicate local workspace ID " + ws + ".");
          owners.set(ws,p);
        }
      }
      for(const f of files) if(f.isDirectory() && !f.name.startsWith(".") && !reserved.has(f.name.toLowerCase())) walk(join(dir,f.name));
    };
    walk(this.root);
    this.index=projects; this.owners=owners;
  }
  private project(key:unknown) {
    const projectId=id(key);
    let p=this.index.get(projectId);
    // In the public sandbox the index is authoritative: an unknown ID never triggers a walk of the store.
    if ((!p && !this.publicMode) || (p && !sameFolder(p))) {this.refresh(); p=this.index.get(projectId);}
    if (!p) throw missing("project");
    return p;
  }
  private owner(ws:string) {
    let p=this.owners.get(ws);
    if (p && !sameFolder(p)) {this.refresh(); p=this.owners.get(ws);}
    return p;
  }
  owns(ws:string) {return !!this.owner(ws);}
  list():ProjectSummary[] {
    if (!this.publicMode) this.refresh();
    return [...this.index.values()].map(({id,name,folder,workspace})=>({id,name,folder,workspace})).sort((a,b)=>a.folder.localeCompare(b.folder));
  }
  /** What a caller may list: everything locally; only the shared workspace's projects in the public sandbox, where
   *  every other workspace opens only from its link. */
  listed():ProjectSummary[] { return this.publicMode ? this.list().filter(p=>p.workspace===DEFAULT_WORKSPACE) : this.list(); }
  /** True when the store holds no project yet. */
  empty() { return !this.list().length; }
  private registryFile() { return join(this.root,"workspaces.json"); }
  private registry():WorkspaceSummary[] {
    const file=this.registryFile();
    if (!existsSync(file)) return [];
    const raw=JSON.parse(load(file));
    if (!Array.isArray(raw)) throw invalid("Invalid workspaces.json.");
    return raw.map((w:any)=>({id:id(w.id),name:name(w.name)}));
  }
  /** Every workspace. The default one appears while it holds a project or when no other exists. */
  workspaces():WorkspaceSummary[] {
    const listed=this.registry(), projects=this.list();
    const all=[...listed];
    if (!all.some(w=>w.id===DEFAULT_WORKSPACE) && (projects.some(p=>p.workspace===DEFAULT_WORKSPACE) || !all.length))
      all.unshift({id:DEFAULT_WORKSPACE,name:this.publicMode?"Shared":"My workspace"});
    return all;
  }
  private workspace(key:unknown) {
    const wsId=id(key), w=wsId===DEMO_WORKSPACE?DEMO:this.workspaces().find(x=>x.id===wsId);
    if (!w) throw missing("workspace");
    return w;
  }
  /** A workspace with its projects and their scenes, for the menus. */
  tree(key:unknown):WorkspaceTree {
    const w=this.workspace(key);
    // Every browser's demo scene sits in the demo workspace: never list them, or visitors could open each other's.
    if (w.id===DEMO_WORKSPACE) return {...w,projects:[]};
    const projects=[...this.index.values()].filter(p=>p.workspace===w.id).map(p=>({id:p.id,name:p.name,
      scenes:this.scenes(this.project(p.id)).map(s=>({id:s.record.scene.id,name:s.record.scene.name})).sort(byName)})).sort(byName);
    return {...w,projects};
  }
  /** The workspace and project that hold a scene. */
  location(ws:string):SceneLocation {
    const p=this.owner(ws); if(!p) throw missing("scene");
    const w=p.workspace===DEMO_WORKSPACE?DEMO:this.workspaces().find(x=>x.id===p.workspace) ?? {id:p.workspace,name:"Workspace"};
    return {workspace:w,project:{id:p.id,name:p.name}};
  }
  private meta(p:Location, change:Partial<Pick<Location,"name"|"workspace">>={}) {
    write(join(p.dir,"project.json"),{format:PROJECT_FORMAT,id:p.id,name:change.name??p.name,workspace:change.workspace??p.workspace,...(p.copiedFrom?{copiedFrom:p.copiedFrom}:{})});
  }
  private sceneCount() { return [...this.index.values()].reduce((n,p)=>n+p.workspaces.length,0); }
  private roomForCreation() {
    if (this.publicMode && this.sceneCount()>=LIMITS.workspacesMax) throw new ProjectError("full","The public sandbox is full.","Try again later or use a local installation.",503);
  }
  /** Adopt scenes from the retired single-file room store into one new project, keeping each scene's ID, revision
   *  and undo history. */
  adopt(title:string, records:RoomRecord[], workspace:string, assessment?:unknown) {
    this.atDestination(this.defaultFolder(title),dest=>{
      const stage=mkdtempSync(join(this.dataDir,".project-stage-"));
      try {
        for(const sub of ["scenes","versions","dependencies"]) mkdir(join(stage,sub));
        write(join(stage,"project.json"),{format:PROJECT_FORMAT,id:randomUUID(),name:name(title),workspace});
        atom(join(stage,"project.md"),"# "+title+"\n");
        for(const record of records) write(join(stage,"scenes",record.scene.id+".json"),{portableId:record.scene.id,sourceRevision:record.scene.version,record});
        if(assessment!==undefined) write(join(stage,"assessment.json"),assessment);
        renameSync(stage,dest);
      } finally {rmSync(stage,{recursive:true,force:true});}
    });
    this.refresh();
  }
  /** A workspace for adopted scenes that the public list does not show. */
  addWorkspace(title:string) {
    const w={id:randomUUID(),name:name(title)};
    write(this.registryFile(),[...this.registry(),w]);
    return w.id;
  }
  private scene(p:Location, ws:string):StoredScene {
    if (!p.workspaces.includes(ws)) throw missing("scene");
    const raw=JSON.parse(load(join(p.dir,"scenes",ws+".json")));
    if (!safeRevision(raw.sourceRevision)) throw invalid("Invalid folder scene revision.");
    const record=parseRoom(JSON.stringify(raw.record));
    if (record.scene.id!==ws) throw invalid("Workspace ID differs from its scene filename.");
    return {portableId:id(raw.portableId),sourceRevision:raw.sourceRevision,record};
  }
  private scenes(p:Location) {return p.workspaces.map(ws=>this.scene(p,ws));}
  private versions(p:Location):NamedVersion[] {
    return fileIds(join(p.dir,"versions")).map(v=>JSON.parse(load(join(p.dir,"versions",v+".json"))));
  }
  private attachment(p:Location) {
    const path=join(p.dir,"assessment.json");
    return existsSync(path)? JSON.parse(load(path)):undefined;
  }
  readAssessment(ws:string) {const p=this.owner(ws); if (!p) throw missing("scene"); return this.attachment(p);}
  writeAssessment(ws:string,data:unknown) {
    const p=this.owner(ws); if (!p) throw missing("scene");
    const value=JSON.stringify(data);
    if (this.publicMode && Buffer.byteLength(value)>8*1024*1024) throw new RoomError("assessment_limit","Saved assessments for this project are full.","Export saved results and start another project.");
    atom(join(p.dir,"assessment.json"),value);
  }
  portableId(ws:string) {const p=this.owner(ws); return p?this.scene(p,ws).portableId:ws;}
  read(ws:string) {
    const p=this.owner(ws); if(!p) throw missing("scene");
    return this.scene(p,ws).record;
  }
  edit(ws:string, mutate:(old:RoomRecord)=>RoomRecord) {
    const p=this.owner(ws); if(!p) throw missing("scene");
    const stored=this.scene(p,ws), record=mutate(stored.record);
    if(record!==stored.record) {
      const doc=JSON.stringify({...stored,sourceRevision:record.scene.version,record});
      if (this.publicMode && (record.scene.instances.length>300 || Buffer.byteLength(doc)>1024*1024))
        throw new RoomError("scene_limit","The scene reached the public storage limit.","Remove objects or continue on a local installation.");
      atom(join(p.dir,"scenes",ws+".json"),doc);
    }
    return record;
  }
  private snapshot(p:Location):ProjectSnapshot {
    const assessment=this.attachment(p);
    return snapshotOrder({id:p.id,name:p.name,markdown:load(join(p.dir,"project.md")),scenes:this.scenes(p).map(source),versions:this.versions(p),...(assessment===undefined?{}:{assessment})});
  }
  private async assessmentValidator() { return (await import("./assessment.ts")).validateAssessmentAttachment; }
  private async withSnapshot<T>(p:Location, run:(current:ProjectSnapshot,pins:string[])=>T):Promise<T> {
    // An await may permit another editor to change the project. Read again inside the synchronous commit interval.
    const validator=await (existsSync(join(p.dir,"assessment.json")) ? this.assessmentValidator():undefined);
    p=this.project(p.id);
    const project=this.snapshot(p);
    if(project.assessment!==undefined && !validator) return this.withSnapshot(p,run);
    const pins=project.assessment!==undefined ? validator!(project.assessment,project.scenes.map(s=>s.id)):[];
    return run(project,pins);
  }
  private async detail(p:Location):Promise<ProjectDetail> {
    return this.withSnapshot(p,(s,pins)=>({
      id:p.id,name:s.name,folder:this.project(p.id).folder,workspace:p.workspace,markdown:s.markdown,
      scenes:this.scenes(this.project(p.id)).map(v=>({id:v.record.scene.id,portable:v.portableId,name:v.record.scene.name,revision:v.record.scene.version})),
      versions:s.versions.map(v=>({id:v.id,name:v.name,scene:v.scene.id,revision:v.scene.version})),
      dependencies:projectPins(s,pins).map(pin=>({pin,redistributable:this.catalog.releases.some(r=>r.id===pin) && !!this.catalog.transfer?.describe(pin).redistributable})),
    }));
  }
  private defaultFolder(label:string) {
    const base=folderLabel(label);
    let folder=reserved.has(base.toLowerCase())?base+" project":base;
    const first=folder;
    for(let i=2;existsSync(join(this.root,folder));i++) folder=first+" ("+i+")";
    return folder;
  }
  private atDestination<T>(folder:string, fn:(dest:string)=>T) {
    const parts=safeFolder(folder).split("/"), created:string[]=[];
    let parent=this.root;
    try {
      for(const part of parts.slice(0,-1)) {
        parent=join(parent,part);
        if(!existsSync(parent)) { mkdir(parent); created.push(parent); }
        if(!lstatSync(parent).isDirectory()) throw invalid("A parent folder must be a real directory.");
      }
      const dest=join(parent,parts.at(-1)!);
      if(existsSync(dest)) throw conflict("The destination folder already exists.","Choose a new folder name inside the projects directory.");
      return fn(dest);
    } catch(e) {
      for(const dir of created.reverse()) {try{rmdirSync(dir);}catch{/* Do not remove user files. */}}
      throw e;
    }
  }
  private install(project:ProjectSnapshot, folder:string, deps:ProjectDependency[], copiedFrom?:string, workspace=DEFAULT_WORKSPACE) {
    return this.atDestination(folder,dest=>{
      const stage=mkdtempSync(join(this.dataDir,".project-stage-"));
      try {
        for(const sub of ["scenes","versions","dependencies"]) mkdir(join(stage,sub));
        write(join(stage,"project.json"),{format:PROJECT_FORMAT,id:project.id,name:project.name,workspace,...(copiedFrom?{copiedFrom}:{})});
        atom(join(stage,"project.md"),project.markdown);
        for(const scene of project.scenes) {
          const live=randomUUID(), record={scene:{...scene,id:live,version:0},history:[]};
          write(join(stage,"scenes",live+".json"),{portableId:scene.id,sourceRevision:scene.version,record});
        }
        for(const v of project.versions) write(join(stage,"versions",v.id+".json"),v);
        if(project.assessment!==undefined) write(join(stage,"assessment.json"),project.assessment);
        retainEmbedded(stage,deps);
        renameSync(stage,dest);
      } finally {rmSync(stage,{recursive:true,force:true});}
    });
  }
  private template(raw:unknown) {
    if(raw!==undefined && raw!=="demo" && raw!=="empty") throw invalid("Choose the template empty or demo.");
    return raw==="demo"?"demo" as const:"empty" as const;
  }
  /** A new project with one scene, inside a workspace. Returns the project and its scene. */
  private createProject(workspace:string, title:string|undefined, sceneName:string|undefined, template:"empty"|"demo", folder?:unknown, record?:unknown) {
    this.roomForCreation();
    const used=[...this.index.values()].filter(p=>p.workspace===workspace).map(p=>p.name);
    const projectName=title===undefined?nextName("My project","Project",used):name(title);
    const scene=newRoom(randomUUID(),name(sceneName??"Scene 1"),this.catalog,template).scene;
    const p:ProjectSnapshot={id:randomUUID(),name:projectName,markdown:markdown(record??("# "+projectName+"\n")),scenes:[scene],versions:[]};
    this.install(p,folder===undefined?this.defaultFolder(projectName):safeFolder(folder),[],undefined,workspace);
    this.refresh();
    // The live scene ID (the link that opens it) differs from the portable ID that a package carries.
    return {project:p.id,scene:this.project(p.id).workspaces[0]!};
  }
  async run(command:string,a:Record<string,unknown>):Promise<unknown> {
    if(this.publicMode && !PUBLIC_COMMANDS.has(command))
      throw new ProjectError("local_only","This command is available on a local installation only.","Run Synergon locally to manage project files, versions and transfers.",403);
    if(command==="project.list") return {projects:this.listed()};
    if(command==="project.import") return this.import(a);
    if(command==="demo.open") {
      // With the browser's own demo scene: reset it to the furnished default (a new revision, an empty undo history)
      // and return it. Without one: make a demo scene for this browser.
      if(a.scene!==undefined) {
        const ws=id(a.scene), p=this.owner(ws);
        if(!p || p.workspace!==DEMO_WORKSPACE) throw new ProjectError("not_demo","That scene is not a demo scene.","Call demo.open without a scene for a new demo.",404);
        const stored=this.scene(p,ws), next=stored.record.scene.version+1, fresh=newRoom(ws,"Control room",this.catalog,"demo");
        const record:RoomRecord={scene:{...fresh.scene,id:ws,version:next},history:[],historyStart:next};
        atom(join(p.dir,"scenes",ws+".json"),JSON.stringify({...stored,sourceRevision:next,record}));
        this.publish(record.scene);
        return {scene:ws,reset:true};
      }
      return {scene:this.createProject(DEMO_WORKSPACE,"Demo","Control room","demo").scene,reset:false};
    }
    if(command==="workspace.create") {
      this.roomForCreation();
      const listed=this.workspaces();
      // In the public sandbox every visitor's first workspace is "My workspace": a count would reveal how many others exist.
      const title=a.name!==undefined?name(a.name):this.publicMode?"My workspace":nextName("My workspace","Workspace",listed.map(w=>w.name));
      const workspace={id:randomUUID(),name:title};
      write(this.registryFile(),[...this.registry(),workspace]);
      const template=this.template(a.template);
      return {workspace:workspace.id,...this.createProject(workspace.id,undefined,template==="demo"?"Control room":undefined,template)};
    }
    if(command==="workspace.rename") {
      const w=this.workspace(a.workspace), title=name(a.name), listed=this.registry();
      write(this.registryFile(),listed.some(x=>x.id===w.id)?listed.map(x=>x.id===w.id?{...x,name:title}:x):[...listed,{id:w.id,name:title}]);
      return this.tree(w.id);
    }
    if(command==="project.create") {
      const workspace=this.workspace(a.workspace??DEFAULT_WORKSPACE).id;
      const made=this.createProject(workspace,a.name as string|undefined,a.sceneName as string|undefined,this.template(a.template),a.folder,a.markdown);
      return {...await this.detail(this.project(made.project)),scene:made.scene};
    }
    if(command==="scene.rename") {
      const ws=id(a.scene), title=name(a.name);
      const record=this.edit(ws,old=>({...old,scene:{...old.scene,name:title}}));
      this.publish(record.scene);
      return {id:ws,name:title};
    }
    const p=command==="project.open" && a.scene!==undefined ? this.owner(id(a.scene)):this.project(a.project);
    if(!p) throw missing("project for scene");
    if(command==="project.open") return this.detail(p);
    if(command==="project.move") {
      const folder=safeFolder(a.folder);
      if(folder===p.folder) return this.detail(p);
      if(folder.startsWith(p.folder+"/")) throw invalid("Cannot move a project inside itself.");
      this.atDestination(folder,dest=>renameSync(p.dir,dest)); this.refresh();
    } else if(command==="project.rename") {
      this.meta(p,{name:name(a.name)}); this.refresh();
    } else if(command==="project.record") {
      if(load(join(p.dir,"project.md"))!==a.previous) throw conflict("The project record changed.","Reopen the project, merge your edits and save again.");
      atom(join(p.dir,"project.md"),markdown(a.markdown));
    } else if(command==="project.scene") {
      this.roomForCreation();
      const used=this.scenes(p).map(s=>s.record.scene.name);
      const record=newRoom(randomUUID(),a.name===undefined?nextName("Scene 1","Scene",used):name(a.name),this.catalog,this.template(a.template));
      write(join(p.dir,"scenes",record.scene.id+".json"),{portableId:randomUUID(),sourceRevision:0,record}); this.refresh();
      return {...await this.detail(this.project(p.id)),scene:record.scene.id};
    } else if(command==="project.save") {
      const key=id(a.scene), stored=this.scenes(p).find(s=>s.portableId===key || s.record.scene.id===key);
      if(!stored) throw missing("scene");
      if(a.expectedVersion!==undefined && a.expectedVersion!==stored.record.scene.version) throw conflict("The scene changed.","Read its revision before saving.");
      const v:NamedVersion={id:randomUUID(),name:name(a.name),scene:source(stored)};
      write(join(p.dir,"versions",v.id+".json"),v);
    } else if(command==="project.restore" || command==="project.compare") {
      const versions=this.versions(p), key=id(a.version), version=versions.find(v=>v.id===key);
      if(!version) throw missing("named version");
      const stored=this.scenes(p).find(s=>s.portableId===version.scene.id);
      if(!stored) throw missing("scene");
      if(command==="project.compare") {
        const other=a.other!==undefined?versions.find(v=>v.id===id(a.other)):undefined;
        if(a.other!==undefined && (!other || other.scene.id!==version.scene.id)) throw invalid("Choose another version of the same scene.");
        return compare(version.scene,other?.scene??source(stored));
      }
      if(a.expectedVersion!==stored.record.scene.version) throw conflict("The scene changed or its revision was omitted.","Read its current revision before restoring.");
      for(const i of version.scene.instances) if(!this.catalog.releases.some(r=>r.id===i.release)) throw new ProjectError("missing_release","Missing "+i.release,"Install its exact release before restoring.");
      const next=stored.record.scene.version+1;
      const record:RoomRecord={scene:{...version.scene,id:stored.record.scene.id,version:next},history:[],historyStart:next};
      write(join(p.dir,"scenes",record.scene.id+".json"),{...stored,record,sourceRevision:next});
      this.publish(record.scene);
    } else if(command==="project.export") {
      return this.withSnapshot(p,(s,pins)=>makePackage(s,pins,this.catalog,(a.defaultMode??"embed") as ReleaseMode,(a.modes??{}) as Record<string,ReleaseMode>));
    } else throw invalid("Unknown project command.");
    return this.detail(this.project(p.id));
  }
  private async import(a:Record<string,unknown>) {
    const {project,dependencies}=inspectPackage(a.package);
    const assessment=project.assessment!==undefined?await import("./assessment.ts"):undefined;
    const pins=assessment?assessment.validateAssessmentAttachment(project.assessment,project.scenes.map(s=>s.id)):[];
    const prepared=resolvePackage(project,dependencies,pins,this.catalog);
    if(assessment) assessment.verifyAssessmentReplay(project.assessment,prepared.catalog);
    if(a.separateCopy!==undefined && typeof a.separateCopy!=="boolean") throw invalid("separateCopy must be a boolean.");
    const folder=a.folder!==undefined?safeFolder(a.folder):undefined;
    this.refresh();
    const existing=this.index.get(project.id);
    if(existing) {
      const incoming=snapshotOrder(project);
      const match=[existing,...[...this.index.values()].filter(p=>p.copiedFrom===project.id)]
        .find(p=>isDeepStrictEqual(this.snapshot(p),{...incoming,id:p.id}));
      if(match) {
        const updated=retainEmbedded(match.dir,dependencies);
        prepared.commit();
        return {status:updated?"updated":"unchanged",project:await this.detail(match)};
      }
      if(!a.separateCopy) throw new ProjectError("project_conflict","A different project with ID "+project.id+" already exists.","Choose Import as separate copy to keep both projects.",409);
    }
    const result=existing?{...project,id:randomUUID()}:project;
    this.install(result,folder??this.defaultFolder(result.name),dependencies,existing?project.id:undefined,a.workspace===undefined?DEFAULT_WORKSPACE:this.workspace(a.workspace).id);
    prepared.commit(); this.refresh();
    return {status:existing?"copied":"imported",project:await this.detail(this.project(result.id))};
  }
}
function compare(left:RoomScene,right:RoomScene) {
  const changes:{path:string;before:unknown;after:unknown}[]=[];
  const walk=(path:string,a:unknown,b:unknown)=>{
    if(isDeepStrictEqual(a,b)) return;
    if(object(a)&&object(b)) for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort()) walk(path+"/"+key,a[key],b[key]);
    else changes.push({path,before:a??null,after:b??null});
  };
  for(const k of ["name","room","person","lighting","content"] as const) walk(k,left[k],right[k]);
  const byId=(s:RoomScene)=>Object.fromEntries(s.instances.map(i=>[i.id,i]));
  walk("instances",byId(left),byId(right));
  return {scene:left.id,fromRevision:left.version,toRevision:right.version,changes};
}
