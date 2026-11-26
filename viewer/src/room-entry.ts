if (location.pathname.startsWith("/workspaces")) {
  for (const path of ["/room.css", "/room-view.css"]) {
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = path; document.head.append(link);
  }
  document.body.className = "";
  document.body.replaceChildren();
  const { startRoomApp } = await import("./room-app.ts");
  await startRoomApp();
}
export {};
