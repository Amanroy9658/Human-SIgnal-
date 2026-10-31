"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, ArrowRight, Bot, Check, ChevronRight, Copy, Crown, Gamepad2, Globe2, Loader2, LockKeyhole, Radio, Sparkles, Trophy, Users, Wifi, Zap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { QUESTIONS, type GameQuestion } from "@/lib/questions";

type Player = { id: string; room_code: string; nickname: string; score: number; is_host: boolean; ready: boolean; joined_at: string };
type Room = { code: string; status: "lobby"|"playing"|"finished"; host_id: string; current_round: number; total_rounds: number; question_id: string|null; round_ends_at: string|null; mode: string; updated_at: string };
const avatars = ["🦊","🐼","🐸","🦄","🐙","🐯","🐧","🦉"];
const modes = ["MIXED","PROMPT MASTER","HALLUCINATION HUNTER","AI JUDGE","BIAS BUSTER","HUMAN VS AI"];

export default function Home() {
  const [view,setView] = useState<"home"|"lobby"|"game"|"results">("home");
  const [nickname,setNickname] = useState("");
  const [roomCode,setRoomCode] = useState("");
  const [room,setRoom] = useState<Room|null>(null);
  const [players,setPlayers] = useState<Player[]>([]);
  const [playerId,setPlayerId] = useState("");
  const [mode,setMode] = useState("MIXED");
  const [rounds,setRounds] = useState(5);
  const [question,setQuestion] = useState<GameQuestion|null>(null);
  const [selected,setSelected] = useState<number|null>(null);
  const [seconds,setSeconds] = useState(20);
  const [answerState,setAnswerState] = useState<{correct:boolean; points:number}|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [copied,setCopied] = useState(false);
  const [notice,setNotice] = useState("SYSTEM ONLINE · HUMAN INTELLIGENCE DETECTED");
  const configured = !!supabase;

  const sortedPlayers = useMemo(()=>[...players].sort((a,b)=>b.score-a.score),[players]);
  const me = players.find(p=>p.id===playerId);
  const isHost = !!me?.is_host;

  useEffect(() => {
  const client = supabase;

  if (!room?.code || !client) return;

  const channel = client
    .channel(`room-${room.code}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "rooms",
        filter: `code=eq.${room.code}`
      },
      (payload) => {
        if (payload.new && "code" in payload.new) {
          setRoom(payload.new as Room);
        }
      }
    )
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "players",
        filter: `room_code=eq.${room.code}`
      },
      () => refreshPlayers(room.code)
    )
    .subscribe();

  refreshPlayers(room.code);

  return () => {
    client.removeChannel(channel);
  };
}, [room?.code]);

  useEffect(()=>{
    if(room?.status==="playing" && room.question_id) {
      const q=QUESTIONS.find(x=>x.id===room.question_id) || null;
      setQuestion(q); setSelected(null); setAnswerState(null);
      const end=room.round_ends_at ? new Date(room.round_ends_at).getTime() : Date.now()+20000;
      const tick=()=>setSeconds(Math.max(0,Math.ceil((end-Date.now())/1000)));
      tick(); const timer=setInterval(tick,250); return ()=>clearInterval(timer);
    }
    if(room?.status==="finished") setView("results");
    if(room?.status==="playing") setView("game");
  },[room?.status,room?.question_id,room?.round_ends_at]);

  async function refreshPlayers(code:string) {
    if(!supabase) return;
    const {data}=await supabase.from("players").select("*").eq("room_code",code).order("joined_at");
    if(data) setPlayers(data as Player[]);
  }
  function fail(message:string){setError(message);setBusy(false);}
  async function createRoom(){
    if(!supabase) return fail("Add your Supabase URL and anon key in .env.local first.");
    if(nickname.trim().length<2) return fail("Enter a nickname with at least 2 characters.");
    setBusy(true);setError("");
    const {data,error}=await supabase.rpc("create_room",{p_nickname:nickname.trim(),p_total_rounds:rounds,p_mode:mode});
    if(error) return fail(error.message);
    const result=Array.isArray(data)?data[0]:data;
    setPlayerId(result.player_id);setRoomCode(result.room_code);setRoom({code:result.room_code,status:"lobby",host_id:result.player_id,current_round:0,total_rounds:rounds,question_id:null,round_ends_at:null,mode,updated_at:new Date().toISOString()});
    await refreshPlayers(result.room_code);setView("lobby");setBusy(false);
  }
  async function joinRoom(){
    if(!supabase) return fail("Add your Supabase URL and anon key in .env.local first.");
    if(nickname.trim().length<2) return fail("Enter a nickname with at least 2 characters.");
    if(roomCode.trim().length!==6) return fail("Room codes have 6 characters.");
    setBusy(true);setError("");
    const {data,error}=await supabase.rpc("join_room",{p_room_code:roomCode.trim().toUpperCase(),p_nickname:nickname.trim()});
    if(error) return fail(error.message);
    const result=Array.isArray(data)?data[0]:data;
    setPlayerId(result.player_id);setRoomCode(roomCode.trim().toUpperCase());
    const {data:r}=await supabase.from("rooms").select("*").eq("code",roomCode.trim().toUpperCase()).single();
    if(r) setRoom(r as Room);
    await refreshPlayers(roomCode.trim().toUpperCase());setView("lobby");setBusy(false);
  }
  async function toggleReady(){
    if(!supabase||!playerId) return;
    const {error}=await supabase.rpc("toggle_ready",{p_player_id:playerId});
    if(error) setError(error.message);
    await refreshPlayers(roomCode);
  }
  async function startGame(){
    if(!supabase||!room) return;
    setBusy(true);
    const {error}=await supabase.rpc("start_game",{p_room_code:room.code,p_host_id:playerId});
    if(error) setError(error.message);
    setBusy(false);
  }
  async function submitAnswer(index:number){
    if(!supabase||!room||!question||selected!==null||seconds<=0) return;
    setSelected(index);
    const {data,error}=await supabase.rpc("submit_answer",{p_room_code:room.code,p_player_id:playerId,p_question_id:question.id,p_answer_index:index});
    if(error){setError(error.message);return;}
    const result=Array.isArray(data)?data[0]:data;
    setAnswerState({correct:!!result.correct,points:Number(result.points||0)});
    await refreshPlayers(room.code);
  }
  async function nextRound(){
    if(!supabase||!room) return;
    const {error}=await supabase.rpc("advance_round",{p_room_code:room.code,p_host_id:playerId});
    if(error) setError(error.message);
  }
  async function copyCode(){
    await navigator.clipboard.writeText(roomCode);setCopied(true);setTimeout(()=>setCopied(false),1600);
  }
  function reset(){
    setView("home");setRoom(null);setPlayers([]);setPlayerId("");setQuestion(null);setSelected(null);setAnswerState(null);setError("");
  }

  return <main className="shell">
    <div className="ambient ambient-one"/><div className="ambient ambient-two"/>
    <nav className="nav"><a className="brand" onClick={reset}><span className="brand-icon"><Radio size={19}/></span><span>HUMAN<span className="brand-accent">SIGNAL</span></span></a><div className="nav-right"><span className="live-pill"><i/> LIVE PARTY GAME</span><span className="version">BETA 01</span></div></nav>
    <AnimatePresence mode="wait">
      {view==="home" && <motion.section key="home" className="hero-wrap" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}}>
        <div className="hero-copy"><div className="eyebrow"><Sparkles size={13}/> THE HUMAN INTELLIGENCE TEST</div><h1>Can you outthink<br/><span>the machine?</span></h1><p className="hero-sub">The AI training party game. Spot hallucinations, judge responses, and prove your human instincts are the real superpower.</p>
          <div className="feature-row"><span><Users size={15}/> 2–8 players</span><span><Zap size={15}/> 5 fast rounds</span><span><Globe2 size={15}/> Any device</span></div>
          <div className="mascot-stage"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><motion.div className="mascot" animate={{y:[0,-9,0],rotate:[-2,2,-2]}} transition={{duration:4,repeat:Infinity,ease:"easeInOut"}}><Bot size={78} strokeWidth={1.35}/><span className="mascot-eye eye-left"/><span className="mascot-eye eye-right"/></motion.div><div className="mascot-label"><span className="signal-dot"/> SIGNAL IS THINKING</div><div className="float-chip chip-one">✦ HUMAN FEEDBACK</div><div className="float-chip chip-two">⚡ +150 XP</div></div>
          <div className="mode-strip">{["PROMPT MASTER","HALLUCINATION HUNTER","AI JUDGE","BIAS BUSTER"].map(x=><span key={x}>{x}</span>)}</div>
        </div>
        <div className="join-card"><div className="card-top"><div><div className="card-kicker">ENTER THE ARENA</div><h2>Ready, human?</h2></div><div className="card-symbol"><Gamepad2 size={22}/></div></div>
          <label className="field-label">YOUR PLAYER NAME</label><input value={nickname} onChange={e=>setNickname(e.target.value)} maxLength={16} placeholder="e.g. PromptWizard" className="input"/>
          <div className="divider"><span>CREATE A NEW GAME</span></div>
          <label className="field-label">GAME MODE</label><select className="input select" value={mode} onChange={e=>setMode(e.target.value)}>{modes.map(m=><option key={m}>{m}</option>)}</select>
          <label className="field-label">NUMBER OF ROUNDS <b>{rounds}</b></label><input type="range" min="3" max="8" value={rounds} onChange={e=>setRounds(Number(e.target.value))} className="range"/>
          <button className="primary-btn" onClick={createRoom} disabled={busy}>{busy?<Loader2 className="spin"/>:<Zap size={17}/>} CREATE GAME ROOM <ArrowRight size={16}/></button>
          <div className="divider"><span>OR JOIN YOUR FRIENDS</span></div>
          <div className="join-row"><input className="input code-input" placeholder="6-DIGIT CODE" maxLength={6} value={roomCode} onChange={e=>setRoomCode(e.target.value.toUpperCase())}/><button className="join-btn" onClick={joinRoom} disabled={busy}>JOIN <ChevronRight size={16}/></button></div>
          {!configured&&<div className="setup-warning"><LockKeyhole size={14}/> Supabase setup required — see README.</div>}
          {error&&<p className="error">{error}</p>}
          <div className="privacy-note"><LockKeyhole size={12}/> No account. No downloads. Just brainpower.</div>
        </div>
      </motion.section>}
      {view==="lobby" && <motion.section key="lobby" className="room-wrap" initial={{opacity:0,y:15}} animate={{opacity:1,y:0}}>
        <div className="room-heading"><div><div className="eyebrow"><Radio size={13}/> TRANSMISSION ESTABLISHED</div><h1>Waiting for <span>humans.</span></h1><p>Invite your crew. The arena opens when the host says go.</p></div><div className="room-code-box"><small>ROOM CODE</small><button onClick={copyCode}>{roomCode} {copied?<Check size={16}/>:<Copy size={16}/>}</button></div></div>
        <div className="lobby-grid"><div className="panel players-panel"><div className="panel-title"><span><Users size={17}/> PLAYERS IN LOBBY</span><b>{players.length}/8</b></div><div className="player-grid">{players.map((p,i)=><div className={`player-tile ${p.id===playerId?"you":""}`} key={p.id}><div className="avatar">{avatars[i%avatars.length]}</div><div><strong>{p.nickname} {p.id===playerId&&"(YOU)"}</strong><small>{p.is_host?"ROOM HOST":p.ready?"READY":"GETTING READY"}</small></div><span className={`status-dot ${p.ready||p.is_host?"ready":""}`}/></div>)}</div><div className="lobby-actions"><button className="secondary-btn" onClick={toggleReady}>TOGGLE READY</button>{isHost&&<button className="primary-btn compact" onClick={startGame} disabled={busy||players.length<2}>{busy?<Loader2 className="spin"/>:<Zap size={16}/>} START GAME <ArrowRight size={15}/></button>}</div>{players.length<2&&<p className="hint">Waiting for at least one more player to join…</p>}</div>
          <aside className="panel briefing"><div className="brief-icon"><Bot size={27}/></div><div className="card-kicker">MISSION BRIEFING</div><h3>Humanity needs<br/>your judgment.</h3><p>Five fast-paced rounds. Make sharp calls, spot AI mistakes, and climb the leaderboard.</p><div className="brief-stat"><span>GAME MODE</span><b>{mode}</b></div><div className="brief-stat"><span>ROUNDS</span><b>{rounds}</b></div><div className="brief-stat"><span>PLAYERS</span><b>{players.length} / 8</b></div></aside></div>
      </motion.section>}
      {view==="game" && <motion.section key="game" className="game-wrap" initial={{opacity:0}} animate={{opacity:1}}>
        <div className="game-top"><div className="round-tag">ROUND {room?.current_round} <span>/ {room?.total_rounds}</span></div><div className="timer"><Activity size={16}/><b>00:{String(seconds).padStart(2,"0")}</b></div><div className="mini-score"><Trophy size={15}/> {me?.score||0} XP</div></div>
        <div className="progress-track"><i style={{width:`${((room?.current_round||1)/(room?.total_rounds||5))*100}%`}}/></div>
        {question&&<div className="question-area"><div className="question-meta"><span>{question.mode}</span><span>{question.category}</span></div><h2>{question.prompt}</h2><p className="context">{question.context}</p><div className="answers">{question.options.map((option,i)=><button key={i} disabled={selected!==null||seconds===0} onClick={()=>submitAnswer(i)} className={`answer ${selected===i?"chosen":""} ${answerState&&i===question.correctIndex?"right":""}`}><span className="answer-letter">{["A","B","C","D"][i]}</span>{option}{answerState&&i===question.correctIndex&&<Check size={18}/>}</button>)}</div>
          {answerState&&<div className={`feedback ${answerState.correct?"good":"bad"}`}><b>{answerState.correct?"SIGNAL CONFIRMED":"NOT QUITE — LEARN THE SIGNAL"}</b><span>{answerState.correct?`+${answerState.points} XP · `:""}{question.explanation}</span></div>}
          {seconds===0&&!answerState&&<div className="feedback bad"><b>TIME SIGNAL LOST</b><span>Round timer expired. Wait for the host to advance.</span></div>}
          {isHost&&<button className="primary-btn next-btn" onClick={nextRound}>{room?.current_round===room?.total_rounds?"SHOW FINAL RESULTS":"NEXT ROUND"} <ArrowRight size={16}/></button>}
        </div>}
        <div className="live-players">{sortedPlayers.map((p,i)=><div key={p.id}><span>{avatars[players.findIndex(x=>x.id===p.id)%avatars.length]}</span><small>{p.nickname}</small><b>{p.score}</b>{i===0&&<Crown size={13}/>}</div>)}</div>
      </motion.section>}
      {view==="results" && <motion.section key="results" className="results-wrap" initial={{opacity:0,y:15}} animate={{opacity:1,y:0}}><div className="eyebrow"><Trophy size={14}/> SIGNAL ANALYSIS COMPLETE</div><div className="winner-icon">🏆</div><h1>{sortedPlayers[0]?.nickname||"Human"} <span>takes the crown.</span></h1><p className="hero-sub">Your group has completed the human intelligence test.</p><div className="final-board">{sortedPlayers.map((p,i)=><div className="score-row" key={p.id}><b>#{i+1}</b><span>{avatars[players.findIndex(x=>x.id===p.id)%avatars.length]}</span><strong>{p.nickname} {p.id===playerId?"(YOU)":""}</strong><em>{p.score} XP</em></div>)}</div><button className="primary-btn" onClick={reset}>PLAY ANOTHER GAME <ArrowRight size={16}/></button></motion.section>}
    </AnimatePresence>
    <footer><span>© 2026 HUMAN SIGNAL</span><span>{notice}</span><span>BUILT FOR THE HUMAN IN THE LOOP <span className="footer-heart">♥</span></span></footer>
  </main>;
}
