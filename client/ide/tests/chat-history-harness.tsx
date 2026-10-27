import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { AgentSessionSummary } from "@coloride/contracts";
import { ChatHistoryDialog } from "../src/features/agents/ChatHistoryDialog";
import "../src/app/styles.css";
const now = new Date();
const yesterday = new Date(now); yesterday.setDate(yesterday.getDate()-1);
const sessions: AgentSessionSummary[] = [
  {sessionId:"a",task:"Initial Greeting Only",cwd:"/projects/godseye",updatedAt:now.toISOString()},
  {sessionId:"b",task:"Fix camera controls",cwd:"/projects/godseye",updatedAt:yesterday.toISOString()},
  {sessionId:"c",task:"Other project",cwd:"/projects/coloride",updatedAt:now.toISOString()},
  {sessionId:"d",task:"Archived work",cwd:"/projects/godseye",updatedAt:now.toISOString(),archived:true},
].map(item => ({agent:"coloride",mode:"act",state:"idle",spentUsd:0,startedAt:now.toISOString(),workspaceKind:"local",...item})) as AgentSessionSummary[];
function Harness() {
  const [open,setOpen] = useState(true), [selected,setSelected] = useState<string|null>("a");
  const [titles,setTitles] = useState<Record<string,string>>({});
  const [pinned,setPinned] = useState<string[]>([]), [hidden,setHidden] = useState<string[]>([]), [archived,setArchived] = useState<string[]>(["d"]);
  const [list,setList] = useState(sessions);
  useEffect(() => {const populate = () => setList([...sessions, ...Array.from({length:30}, (_, index) => ({...sessions[0], sessionId:`extra-${index}`,task:`Conversation ${index}`}))]); window.addEventListener("populate-history",populate); return () => window.removeEventListener("populate-history",populate);}, []);
  return <><button onClick={() => setOpen(true)}>Open history</button><output aria-label="Opened conversation">{selected}</output>{open ? <ChatHistoryDialog
    sessions={list} selectedId={selected} workspacePath="/projects/godseye" workspaceKind="local" filesystemScope="workspace" titles={titles}
    pinnedIds={pinned} hiddenIds={hidden} archivedIds={archived} newChatShortcut="⌘T"
    onDetails={() => {}} onClose={() => setOpen(false)} onNew={() => setSelected("new")}
    onSelect={setSelected} onRename={(id,title) => setTitles(current => ({...current,[id]:title}))}
    onPin={id => setPinned(current => current.includes(id) ? current.filter(item => item!==id) : [...current,id])}
    onArchive={id => setArchived(current => [...current,id])} onTrash={id => setHidden(current => [...current,id])}
    onRestore={async id => {setArchived(current => current.filter(item => item!==id));setHidden(current => current.filter(item => item!==id));setList(current => current.map(item => item.sessionId===id ? {...item,archived:false} : item));}}
  /> : null}</>;
}
createRoot(document.getElementById("root")!).render(<Harness/>);
