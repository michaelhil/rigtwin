const project = /^\/projects(?:\/|$)/.test(location.pathname);
if (project || location.pathname.startsWith("/workspaces")) {
  for (const path of ["/room.css", "/room-view.css"]) {
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = path; document.head.append(link);
  }
  document.body.className = "";
  document.body.replaceChildren();
  if (project) {
    const { startProjectApp } = await import("./project-app.ts");
    document.body.className = "room-app";
    await startProjectApp();
  } else {
    const { startRoomApp } = await import("./room-app.ts");
    await startRoomApp();
  }
}
export {};
