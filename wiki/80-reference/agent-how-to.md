---
title: How to work with Synergon through an AI agent
tldr: Step by step, with screenshots and example requests, how to use an agent harness such as Claude Code or Codex to change, measure and assess a Synergon room in plain words while you watch the result in the viewer beside the conversation.
status: living
updated: 2026-11-27
tags: [how-to, agents, mcp, claude-code, codex]
---

# How to work with Synergon through an AI agent

## TL;DR

- Open your workspace in Synergon and put the agent conversation and the viewer side by side.
- Point the agent at the **Agent guide** (`/llms.txt`): a short page written for AI agents that tells them how to find your workspace, look up parts and send commands.
- Ask in plain words ("lower the monitor at Station A by 3 cm"). The agent uses the same commands as the buttons, so every change appears live in the viewer and in its **Activity** list.
- Ask for numbers, not impressions: distances, clearances and assessment findings come from the server.
- Every change can be undone. The public site is an open sandbox: put nothing confidential in it.

## What you need

- **An agent harness**: a program in which an AI model can read web pages and make web requests on your behalf. Tested here with **Claude Code** (the desktop app's Code tab; the same works in its terminal and IDE versions). **Codex** (OpenAI's command-line tool, IDE extension and app) and other harnesses that can make web requests or connect to an MCP server work the same way. *(Tested with Claude Code; Codex not tested here.)*
- **A Synergon workspace**: a room on the public site, https://synergon.mightwork.ai/, or on a local installation (`bun run serve`).
- Nothing to install in Synergon. The agent talks to the same server the viewer uses.

## Step 1 · Open your workspace

Open the Synergon homepage and choose **Open a workspace** in the bar at the top, or **Open viewer** to return to the last room. The address in the browser, `…/workspaces/room/<id>` on the public site, is the workspace's link. Copy it: it is how you tell the agent which room you mean.

![The Synergon homepage with the Open a workspace menu listing two rooms](../img/agent-how-to/home.jpg)
*The homepage. **Open a workspace** lists the rooms of this installation.*

## Step 2 · Put the conversation and the viewer side by side

You will talk to the agent and watch the room at the same time.

- **Claude Code desktop app:** ask the agent to open the workspace in its browser pane, for example *"Open https://synergon.mightwork.ai/workspaces/room/<id> in the preview browser."* The conversation stays on the left and the viewer opens on the right.
- **Codex, or Claude Code in a terminal:** place the terminal and your web browser next to each other.

Changes made by the agent appear in every open viewer of that workspace within a second, so it does not matter which browser shows the room.

![The Claude Code desktop app in split screen: the conversation on the left, the Synergon viewer with Station A on the right](../img/agent-how-to/split-1.jpg)
*The Claude Code desktop app, conversation left, viewer right (a local installation). Asked to lower Station A's monitor by 6 cm, the agent read the Agent guide, found that only 2 cm of travel was left, reported the eye-to-screen distance (85.2 cm) and asked before changing anything. The viewer still shows Revision 0.*

## Step 3 · Introduce Synergon to the agent with the Agent guide

The **Agent guide** is a short plain-text page at `/llms.txt` (https://synergon.mightwork.ai/llms.txt). It is written for AI agents, not for people. It tells an agent what a workspace contains, how to find a workspace by name, how to look up the exact names of parts and adjustments, how to send a command, how to check that it worked and how to undo it. The homepage links to it (**Agent guide**), and so does the viewer under **Settings → Agent access**.

You do not need to read it. Start the conversation by pointing the agent at it, together with your workspace:

> Read https://synergon.mightwork.ai/llms.txt. Then work with me in the room https://synergon.mightwork.ai/workspaces/room/<id>.

![The top of the Agent guide: it says it is written for AI agents and lists examples of requests](../img/agent-how-to/guide-top.jpg)
*The top of the Agent guide. Its first paragraph tells the agent what it is for.*

The agent can also find a room by name: *"Use the room called Control room."* If several rooms fit, a well-behaved agent asks which one you mean.

## Step 4 · Optional: connect the agent as an MCP tool

With the Agent guide alone, the agent sends ordinary web requests. For a closer connection, a harness that supports MCP (Model Context Protocol, a standard way to give an agent a set of tools) can load the workspace's commands as tools. In the viewer, open **Settings** (the cog at the bottom left), then **Agent access**, and choose **Copy MCP endpoint**.

![The Settings card in the viewer with Agent access open: the workspace MCP endpoint, a Copy MCP endpoint button and a link to the Agent guide](../img/agent-how-to/settings.jpg)
*Settings → Agent access. This screenshot is from a local installation; on the public site the endpoint starts with https://synergon.mightwork.ai.*

Then add it to your harness and start a new conversation:

```bash
claude mcp add --transport http synergon <MCP endpoint>
```

```bash
codex mcp add synergon --url <MCP endpoint>
```

Both routes reach the same commands. Use one; the Agent guide is enough to start.

## Step 5 · Ask in plain words

Say what you want as you would to a colleague. Name the station or object, and give sizes with units. Examples that work:

| You ask | What the agent does |
|---|---|
| *Lower the monitor at Station A by 3 cm.* | Finds Station A's monitor height adjustment and changes it by -3 cm. |
| *Recline the backrest at Station B a little and tell me the new angle.* | Changes the backrest and reports the value it set. |
| *Move the operator desk 50 cm towards the window.* | Moves the desk in the room plan and reports its new position. |
| *How far is the operator's eye from the centre of the screen at Station A?* | Asks the server to measure from the seated operator's eyes and reports the distance. |
| *Is there a clear path from the door to Station B?* | Measures the clearance from the door and reports the narrowest gap. |
| *Run the assessment and list the findings that do not pass.* | Runs the configured assessment and summarises each finding with its status. |
| *Show me the operator's view.* | In the Claude Code desktop app, clicks **Operator's eye** in the viewer in its browser pane. Rooms have no remote camera command yet, so an agent without a browser asks you to click it. |
| *Undo your last two changes.* | Undoes them by their recorded numbers. |

If a request is ambiguous, for example two stations both have a monitor, the agent should ask which one you mean. If an adjustment's range is only assumed, Synergon says so, and the agent should tell you.

## Step 6 · Watch the change and check it

The viewer updates as soon as the agent's command is accepted.

![The same split screen after the reply "Lower it 2 cm": the agent reports the monitor height and eye-to-screen distance before and after, and the viewer shows Revision 1](../img/agent-how-to/split-2.jpg)
*After the reply "Lower it 2 cm": the agent lowered the monitor to its lowest setting, measured again (85.2 cm before, 85.1 cm after) and explained why the distance hardly changes. The viewer's footer now reads Revision 1.*

To see what was done, open **Activity** (the button with the wave symbol at the bottom left). Each change has a number (r1, r2, …), the command and the object it changed.

![The viewer with the Activity list open, showing three changes to Station A made by an agent](../img/agent-how-to/activity.jpg)
*Three adjustments to Station A made by an agent, listed in Activity with their numbers.*

Ask the agent for the numbers behind a change: *"What is the monitor height now, and how is it known?"* Measurements are computed by the server from the model, so they are the same whether a person or an agent asks.

## Step 7 · Undo

Every change made by the agent can be undone: ask the agent (*"undo r3"*, *"undo your last change"*), or undo the latest change in the viewer with Ctrl/Cmd + Z or the undo arrow at the bottom of the left panel.

## Good practice

- **One clear request at a time** at first. When you trust the steps, ask for sequences: *"Try the monitor 2, 4 and 6 cm lower and give me the viewing distance for each."*
- **Ask for a measurement before and after** a change, so the effect is a number, not an impression.
- **Keep the room in view.** If something moves that you did not expect, say so; the agent can read the recent changes and undo the wrong one.
- **Public means public.** On the public site anyone with a workspace link can see and change that room. Use a local installation for anything confidential.

## Related pages

- [Remote commands](remote-commands.md): the command map, receipts, viewer routing and pictures.
- [Agent interface](agent-interface.md): the generated list of tools and adjustments.
- [Room layout](../50-implementation/room-layout.md#agent-entry-point): the room's agent entry point and paths.
- [Skills and agents](skills-and-agents.md): the operating Skill that tells Claude Code how to work in a workspace.
