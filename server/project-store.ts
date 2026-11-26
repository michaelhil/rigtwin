import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PROJECT_FORMAT, type ProjectDependency, type ProjectDetail, type ProjectSnapshot, type ProjectSummary, type NamedVersion, type ReleaseFiles, type ReleaseMode } from "../shared/project.ts";
import type { RoomCatalog, RoomScene } from "../shared/room.ts";
import { newRoom, parseRoom, type RoomRecord } from "./room-model.ts";
import { isWorkspaceId } from "./workspaces.ts";
import { fields, id, inspectPackage, invalid, makePackage, markdown, name, object, ProjectError, projectPins, resolvePackage } from "./project-package.ts";

interface StoredScene { portableId: string; sourceRevision: number; record: RoomRecord }
interface Location extends ProjectSummary { copiedFrom?:string; dir: string; device: number; inode: number; workspaces: string[] }
type EmbeddedRelease = { pin: string; files: ReleaseFiles };
function sameFolder(p:Location) {
  const stat=lstatSync(p.dir,{throwIfNoEntry:false});
  return stat?.isDirectory() && stat.dev===p.device && stat.ino===p.inode;
}
const reserved = new Set(["project.json","project.md","scenes","versions","dependencies","assessment.json"]);
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
  constructor(private dataDir:string, private catalog:RoomCatalog, private publish:(scene:RoomScene)=>void) {
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
        const p={...(meta.copiedFrom?{copiedFrom:id(meta.copiedFrom)}:{}),id:projectId,name:name(meta.name),dir,device:stat.dev,inode:stat.ino,folder:relative(this.root,dir).split(sep).join("/"),workspaces:fileIds(join(dir,"scenes"))};
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
    if (!p || !sameFolder(p)) {this.refresh(); p=this.index.get(projectId);}
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
    this.refresh();
    return [...this.index.values()].map(({id,name,folder})=>({id,name,folder})).sort((a,b)=>a.folder.localeCompare(b.folder));
  }
  private scene(p:Location, ws:string):StoredScene {
    if (!p.workspaces.includes(ws)) throw missing("workspace");
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
  readAssessment(ws:string) {const p=this.owner(ws); if (!p) throw missing("project workspace"); return this.attachment(p);}
  writeAssessment(ws:string,data:unknown) {
    const p=this.owner(ws); if (!p) throw missing("project workspace");
    write(join(p.dir,"assessment.json"),data);
  }
  portableId(ws:string) {const p=this.owner(ws); return p?this.scene(p,ws).portableId:ws;}
  listWorkspaces() {
    return this.list().flatMap(p=>this.scenes(this.project(p.id)).map(({record:{scene:{id,name,version}}})=>({id,name,version})));
  }
  read(ws:string) {
    const p=this.owner(ws); if(!p) throw missing("workspace");
    return this.scene(p,ws).record;
  }
  edit(ws:string, mutate:(old:RoomRecord)=>RoomRecord) {
    const p=this.owner(ws); if(!p) throw missing("workspace");
    const stored=this.scene(p,ws), record=mutate(stored.record);
    if(record!==stored.record) write(join(p.dir,"scenes",ws+".json"),{...stored,sourceRevision:record.scene.version,record});
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
      id:p.id,name:s.name,folder:this.project(p.id).folder,markdown:s.markdown,
      scenes:this.scenes(this.project(p.id)).map(v=>({id:v.portableId,workspace:v.record.scene.id,name:v.record.scene.name,revision:v.record.scene.version})),
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
  private install(project:ProjectSnapshot, folder:string, deps:ProjectDependency[], copiedFrom?:string) {
    return this.atDestination(folder,dest=>{
      const stage=mkdtempSync(join(this.dataDir,".project-stage-"));
      try {
        for(const sub of ["scenes","versions","dependencies"]) mkdir(join(stage,sub));
        write(join(stage,"project.json"),{format:PROJECT_FORMAT,id:project.id,name:project.name,...(copiedFrom?{copiedFrom}:{})});
        atom(join(stage,"project.md"),project.markdown);
        for(const scene of project.scenes) {
          const workspace=randomUUID(), record={scene:{...scene,id:workspace,version:0},history:[]};
          write(join(stage,"scenes",workspace+".json"),{portableId:scene.id,sourceRevision:scene.version,record});
        }
        for(const v of project.versions) write(join(stage,"versions",v.id+".json"),v);
        if(project.assessment!==undefined) write(join(stage,"assessment.json"),project.assessment);
        retainEmbedded(stage,deps);
        renameSync(stage,dest);
      } finally {rmSync(stage,{recursive:true,force:true});}
    });
  }
  async run(command:string,a:Record<string,unknown>):Promise<unknown> {
    if(command==="project.list") return {projects:this.list()};
    if(command==="project.import") return this.import(a);
    if(command==="project.create") {
      const title=name(a.name);
      const p:ProjectSnapshot={id:randomUUID(),name:title,markdown:markdown(a.markdown??("# "+title+"\n")),scenes:[newRoom(randomUUID(),name(a.sceneName??"Scene 1"),this.catalog).scene],versions:[]};
      this.install(p,a.folder===undefined?this.defaultFolder(title):safeFolder(a.folder),[]);
      this.refresh(); return this.detail(this.project(p.id));
    }
    const p=command==="project.open" && a.workspace!==undefined ? this.owner(id(a.workspace)):this.project(a.project);
    if(!p) throw missing("project for workspace");
    if(command==="project.open") return this.detail(p);
    if(command==="project.move") {
      const folder=safeFolder(a.folder);
      if(folder===p.folder) return this.detail(p);
      if(folder.startsWith(p.folder+"/")) throw invalid("Cannot move a project inside itself.");
      this.atDestination(folder,dest=>renameSync(p.dir,dest)); this.refresh();
    } else if(command==="project.rename") {
      write(join(p.dir,"project.json"),{format:PROJECT_FORMAT,id:p.id,name:name(a.name),...(p.copiedFrom?{copiedFrom:p.copiedFrom}:{})}); this.refresh();
    } else if(command==="project.record") {
      if(load(join(p.dir,"project.md"))!==a.previous) throw conflict("The project record changed.","Reopen the project, merge your edits and save again.");
      atom(join(p.dir,"project.md"),markdown(a.markdown));
    } else if(command==="project.scene") {
      if(a.template!==undefined && !["demo","empty"].includes(String(a.template))) throw invalid("Unknown scene template.");
      const record=newRoom(randomUUID(),name(a.name),this.catalog,a.template==="demo"?"demo":"empty");
      write(join(p.dir,"scenes",record.scene.id+".json"),{portableId:randomUUID(),sourceRevision:0,record}); this.refresh();
    } else if(command==="project.save") {
      const key=id(a.scene), stored=this.scenes(p).find(s=>s.portableId===key);
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
    this.install(result,folder??this.defaultFolder(result.name),dependencies,existing?project.id:undefined);
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
  for(const k of ["name","room","person"] as const) walk(k,left[k],right[k]);
  const byId=(s:RoomScene)=>Object.fromEntries(s.instances.map(i=>[i.id,i]));
  walk("instances",byId(left),byId(right));
  return {scene:left.id,fromRevision:left.version,toRevision:right.version,changes};
}
