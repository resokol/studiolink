[Reading 62 lines from line 1 (total: 63 lines, 0 remaining)]


import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RoomContext, StartAudio, VideoConference } from "@livekit/components-react";
import { Room } from "livekit-client";

function MonitorContent() {
  const params = useSearchParams();
  const roomName = params.get("room") || "demo-room";
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: false }));
  const [status, setStatus] = useState("Подключение…");
  const [token, setToken] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [volume, setVolume] = useState(100);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const identity = `monitor-${crypto.randomUUID()}`;
        const response = await fetch(`/api/token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}&name=LAN%20Monitor&role=monitor`);
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        if (!cancelled) setToken(data.token);
      } catch (e) {
        if (!cancelled) setStatus(e instanceof Error ? e.message : "Ошибка подключения");
      }
    })();
    return () => { cancelled = true; };
  }, [roomName]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    (async () => {
      try {
        await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token);
        if (active) setStatus("Онлайн · контроль конференции");
      } catch (e) {
        if (active) setStatus(e instanceof Error ? e.message : "Ошибка подключения");
      }
    })();
    return () => { active = false; room.disconnect(); };
  }, [room, token]);

  return <main className="monitor-page">
    <div className="studio-header">
      <div><p className="muted">StudioLink · LAN Monitor</p><h1>{roomName}</h1></div>
      <div className="monitor-head-actions"><div className="status-pill">{status}</div><button className="settings-gear" title="Настройки звука" aria-label="Настройки звука" onClick={() => setSettingsOpen((v) => !v)}>⚙</button></div>
    </div>
    {settingsOpen && <div className="panel monitor-settings"><strong>Громкость монитора</strong><input type="range" min="0" max="100" value={volume} onChange={(e) => { const v = Number(e.target.value); setVolume(v); document.querySelectorAll<HTMLAudioElement>("audio").forEach((a) => { a.volume = v / 100; }); }} /><span>{volume}%</span></div>}
    <div className="monitor-help">Этот клиент только принимает конференцию: камера и микрофон этого устройства не публикуются.</div>
    <RoomContext.Provider value={room}>
      <StartAudio label="Включить звук конференции" className="monitor-audio-button" />
      <VideoConference />
    </RoomContext.Provider>
  </main>;
}

export default function MonitorPage() {
  return <Suspense fallback={<main><div className="panel">Загрузка Monitor Client…</div></main>}><MonitorContent /></Suspense>;
}

[executed on device: user1-System-Product-Name (49c0e26e-09f4-4b4a-a98b-545df098ad43)]