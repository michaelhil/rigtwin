// File paths in CLI arguments are local to the client. The service only sees the package contents.
import { readFileSync, writeFileSync } from "node:fs";
import { projectCommands } from "../shared/project-commands.ts";
export async function runProjectCli(
  command: string,
  argument: string | undefined,
  request: (path: string, body?: object) => Promise<any>,
): Promise<unknown> {
  if (command === "project.help")
    return {
      commands: projectCommands,
      file: "For project.export, add a file path to its JSON args to save the package. For project.import, supply file instead of package.",
    };
  const args = argument ? JSON.parse(argument) : {};
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Supply JSON object arguments.");
  let output: string | undefined;
  if (command === "project.import" && args.file !== undefined) {
    if (args.package !== undefined || typeof args.file !== "string")
      throw new Error("Choose a single input file or inline package.");
    args.package = JSON.parse(readFileSync(args.file, "utf8"));
    delete args.file;
  }
  if (command === "project.export" && args.file !== undefined) {
    if (typeof args.file !== "string") throw new Error("Supply a file path for export.");
    output = args.file;
    delete args.file;
  }
  const result = await request("/api/projects/command", { id: command, args });
  if (output) {
    writeFileSync(output, JSON.stringify(result), { flag: "wx", mode: 0o600 });
    return { file: output, project: result.project.id, dependencies: result.dependencies.length };
  }
  return result;
}
