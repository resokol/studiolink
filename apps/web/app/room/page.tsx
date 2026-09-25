"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VideoConference, RoomContext } from "@livekit/components-react";
import { Room, RoomEvent, Track, VideoQuality, type RemoteAudioTrack, type RemoteTrackPublication } from "livekit-client";

function slugifyName(value: string) {
  return value.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 32);
}

function AvCheck({ name, onJoin }: { name: string; onJoin: (v: { audioDeviceId?: string; videoDeviceId?: string; height: 720 | 1080; micGain: number; listenGain: number }) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const audioContextRef = useRef<AudioContext | undefined>(undefined);
  const rafRef = useRef<number | undefined>(undefined);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDeviceId, setAudioDeviceId] = useState("");
  const [videoDeviceId, setVideoDeviceId] = useState("");
  const [height, setHeight] = useState<720 | 1080>(720);
  const [level, setLevel] = useState(0);
  const [micGain, setMicGain] = useState(100);

  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        await audioContextRef.current?.close().catch(() => undefined);
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioDeviceId ? { deviceId: { exact: audioDeviceId } } : true,
          video: { ...(videoDeviceId ? { deviceId: { exact: videoDeviceId } } : {}), width: { ideal: height === 1080 ? 1920 : 1280 }, height: { ideal: height }, frameRate: { ideal: 30 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list);
        const a = stream.getAudioTracks()[0]?.getSettings().deviceId || "";
        const v = stream.getVideoTracks()[0]?.getSettings().deviceId || "";
        if (!audioDeviceId && a) setAudioDeviceId(a);
        if (!videoDeviceId && v) setVideoDeviceId(v);
        const ctx = new AudioContext();
        audioContextRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((a, b) => a + b, 0) / data.length;
          setLevel(Math.min(100, Math.round(avg * 1.4)));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
        setError("");
      } catch (e) { setError(e instanceof Error ? e.message : "Не удалось открыть камеру/микрофон"); }
    };
    void start();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); if (rafRef.current) cancelAnimationFrame(rafRef.current); void audioContextRef.current?.close().catch(() => undefined); };
  }, [audioDeviceId, videoDeviceId, height]);

  const audioDevices = devices.filter((d) => d.kind === "audioinput");
  const videoDevices = devices.filter((d) => d.kind === "videoinput");

  return <main><div className="panel av-check">
    <div><p className="muted">StudioLink · проверка перед эфиром</p><h1>{name}</h1></div>
    <video ref={videoRef} muted playsInline className="av-preview" />
    <div className="av-grid">
      <label>Камера<select value={videoDeviceId} onChange={(e) => setVideoDeviceId(e.target.value)}>{videoDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Камера"}</option>)}</select></label>
      <label>Микрофон<select value={audioDeviceId} onChange={(e) => setAudioDeviceId(e.target.value)}>{audioDevices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Микрофон"}</option>)}</select></label>
      <label>Качество<select value={height} onChange={(e) => setHeight(Number(e.target.value) as 720 | 1080)}><option value={720}>720p</option><option value={1080}>1080p</option></select></label>
    </div>
    <div className="audio-gain-row"><span>Микрофон</span><div className="gain-meter"><div className="gain-signal" style={{ width: `${Math.min(100, level * micGain / 100)}%` }} /><input aria-label="Уровень микрофона" type="range" min="0" max="200" value={micGain} onChange={(e) => setMicGain(Number(e.target.value))} /></div><strong>{micGain}%</strong></div>
    {error && <div className="av-error">{error}</div>}
    <button disabled={!!error} onClick={() => onJoin({ audioDeviceId, videoDeviceId, height, micGain, listenGain: 100 })}>Войти в конференцию</button>
  </div></main>;
}

function RoomContent() {
  const params = useSearchParams();
  const initialRoomName = params.get("name") || "demo-room";
  const [roomName, setRoomName] = useState(initialRoomName);
  const [token, setToken] = useState<string>();
  const [error, setError] = useState<string>();
  const [choices, setChoices] = useState<{ audioDeviceId?: string; videoDeviceId?: string; height: 720 | 1080; micGain: number; listenGain: number }>();
  const [studioVolume, setStudioVolume] = useState(100);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mutedByStudio, setMutedByStudio] = useState(false);
  const [mutedForMe, setMutedForMe] = useState<Record<string, boolean>>({});
  const [remoteVersion, setRemoteVersion] = useState(0);
  const [guestName, setGuestName] = useState("");
  const [confirmedName, setConfirmedName] = useState("");
  useEffect(() => {
    if (params.get("moved") !== "1") return;
    try {
      const saved = sessionStorage.getItem("studiolink-guest-session");
      if (saved) {
        const state = JSON.parse(saved);
        if (state.name) { setGuestName(state.name); setConfirmedName(state.name); }
        if (state.choices) setChoices(state.choices);
      }
    } catch {}
  }, [params]);
  const fallbackId = useMemo(() => Math.random().toString(36).slice(2, 8), []);
  const identity = confirmedName ? `guest-${slugifyName(confirmedName) || fallbackId}` : "";
  const [room] = useState(() => new Room({ adaptiveStream: false, dynacast: true, publishDefaults: { simulcast: true, videoEncoding: { maxBitrate: 4_000_000, maxFramerate: 30 }, degradationPreference: "maintain-resolution" } }));

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const focus = target.closest(".lk-focus-toggle-button") as HTMLButtonElement | null;
      if (!focus) return;
      const tile = focus.closest(".lk-participant-tile") as HTMLElement | null;
      if (!tile) return;
      event.preventDefault();
      event.stopPropagation();
      if (document.fullscreenElement === tile) void document.exitFullscreen();
      else void tile.requestFullscreen().catch(() => undefined);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (!identity) return;
    fetch(`/api/token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}&name=${encodeURIComponent(confirmedName)}&role=guest`)
      .then(async (r) => { if (!r.ok) throw new Error(await r.text()); return r.json(); }).then((d) => setToken(d.token)).catch((e) => setError(e.message));
  }, [roomName, identity, confirmedName]);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (!identity || !confirmedName) return;
      try {
        const r = await fetch(`/api/guest-command?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}`, { cache: "no-store" });
        if (r.ok) {
          const data = await r.json();
          if (data?.targetRoom && data.targetRoom !== roomName) {
            try { sessionStorage.setItem("studiolink-guest-session", JSON.stringify({ name: confirmedName, choices })); } catch {}
            window.location.href = `/room?name=${encodeURIComponent(data.targetRoom)}&moved=1`;
            return;
          }
        }
      } catch {}
      if (!stopped) setTimeout(poll, 1000);
    };
    void poll();
    return () => { stopped = true; };
  }, [roomName, identity, confirmedName, choices]);

  void remoteVersion;
  const remoteList = Array.from(room.remoteParticipants.values());
  const toggleRemoteMute = (participantIdentity: string) => {
    const participant = room.remoteParticipants.get(participantIdentity);
    const publication = Array.from(participant?.trackPublications.values() || []).find((pub) => pub.kind === Track.Kind.Audio) as RemoteTrackPublication | undefined;
    const audioTrack = publication?.track as RemoteAudioTrack | undefined;
    const next = !mutedForMe[participantIdentity];
    if (audioTrack) audioTrack.setVolume(next ? 0 : choices?.listenGain ? choices.listenGain / 100 : 1);
    setMutedForMe((s) => ({ ...s, [participantIdentity]: next }));
  };

  if (error) return <main><div className="panel">Ошибка: {error}</div></main>;
  if (!confirmedName) return <main><div className="panel stack guest-name-card"><p className="muted">StudioLink · {roomName}</p><h1>Как вас представить в эфире?</h1><input autoFocus placeholder="Например: Алексей" value={guestName} onChange={(e) => setGuestName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && guestName.trim()) setConfirmedName(guestName.trim()); }} /><button disabled={!guestName.trim()} onClick={() => setConfirmedName(guestName.trim())}>Продолжить</button></div></main>;
  if (!choices) return <AvCheck name={confirmedName} onJoin={setChoices} />;
  if (!token) return <main><div className="panel">Подключение…</div></main>;

  return <main><h1>{roomName}</h1><div className="panel room-info"><div><strong>Гость:</strong> {confirmedName}<small className="quality-state">Камера: {choices.height}p</small>{mutedByStudio && <div className="studio-muted-alert">🎙️🚫 СТУДИЯ ВЫКЛЮЧИЛА ВАС В СВОЁМ МОНИТОРИНГЕ</div>}</div></div>
    {settingsOpen && <div className="panel in-room-settings"><h3>Аудио</h3><div className="remote-mutes">{remoteList.map((p) => <button key={p.identity} className={mutedForMe[p.identity] ? "muted-for-me" : ""} onClick={() => toggleRemoteMute(p.identity)}>{mutedForMe[p.identity] ? "🔇" : "🔊"} {p.name || (p.identity.startsWith("studio-panel-") ? "Студия" : p.identity)}</button>)}</div><div className="audio-gain-row"><span>Микрофон</span><input type="range" min="0" max="200" value={choices.micGain} onChange={(e) => setChoices({ ...choices, micGain: Number(e.target.value) })} /><strong>{choices.micGain}%</strong></div><div className="audio-gain-row"><span>Звук от студии</span><input type="range" min="0" max="100" value={studioVolume} onChange={(e) => { const v = Number(e.target.value); setStudioVolume(v); for (const p of room.remoteParticipants.values()) if (p.identity.startsWith("studio-panel-")) for (const pub of p.trackPublications.values()) if (pub.kind === Track.Kind.Audio && pub.track) (pub.track as RemoteAudioTrack).setVolume(mutedForMe[p.identity] ? 0 : v / 100); }} /><strong>{studioVolume}%</strong></div></div>}
    <div className="guest-conference-shell"><div className="guest-conference-grid"><RoomContext.Provider value={room}><VideoConference /></RoomContext.Provider></div><button className="settings-gear guest-hover-settings" title="Настройки" aria-label="Настройки" onClick={() => setSettingsOpen((v) => !v)}>⚙</button></div>
    <RoomConnector room={room} token={token} choices={choices} onRemoteChange={setRemoteVersion} />
  </main>;
}

function RoomConnector({ room, token, choices, onRemoteChange }: { room: Room; token: string; choices: { audioDeviceId?: string; videoDeviceId?: string; height: 720 | 1080; micGain: number; listenGain: number }; onRemoteChange: React.Dispatch<React.SetStateAction<number>> }) {
  useEffect(() => {
    let active = true;
    const forceStudioHigh = (publication: RemoteTrackPublication) => {
      if (publication.kind !== Track.Kind.Video) return;
      publication.setSubscribed(true);
      publication.setVideoQuality(VideoQuality.HIGH);
      publication.setVideoDimensions({ width: 1920, height: 1080 });
    };
    const onPublished = (publication: RemoteTrackPublication, participant: { identity: string }) => {
      if (participant.identity.startsWith("studio-panel-")) forceStudioHigh(publication);
    };
    room.on(RoomEvent.TrackPublished, onPublished);
    const refreshRemotes = () => onRemoteChange((v) => v + 1);
    room.on(RoomEvent.ParticipantConnected, refreshRemotes);
    room.on(RoomEvent.ParticipantDisconnected, refreshRemotes);
    room.on(RoomEvent.TrackSubscribed, refreshRemotes);
    (async () => {
      try {
        await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token);
        if (!active) return;
        for (const participant of room.remoteParticipants.values()) {
          for (const publication of participant.trackPublications.values()) {
            publication.setSubscribed(true);
            if (participant.identity.startsWith("studio-panel-")) forceStudioHigh(publication);
          }
        }
        await room.localParticipant.setMicrophoneEnabled(true, choices.audioDeviceId ? { deviceId: choices.audioDeviceId } : undefined);
        await room.localParticipant.setCameraEnabled(true, { ...(choices.videoDeviceId ? { deviceId: choices.videoDeviceId } : {}), resolution: { width: choices.height === 1080 ? 1920 : 1280, height: choices.height, frameRate: 30 } });
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cam = devices.find((d) => d.kind === "videoinput" && d.deviceId === choices.videoDeviceId);
        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const micSettings = micPub?.track?.mediaStreamTrack?.getSettings();
        let gpu = "Недоступно браузеру";
        try {
          const canvas = document.createElement("canvas");
          const gl = canvas.getContext("webgl");
          const ext = gl?.getExtension("WEBGL_debug_renderer_info");
          if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
        } catch {}
        const info = {
          type: "guest-client-info",
          camera: cam?.label || "Неизвестная камера",
          cpu: `${navigator.hardwareConcurrency || "?"} логических потоков (модель скрыта браузером)`,
          gpu,
          platform: navigator.platform || "—",
          sampleRate: micSettings?.sampleRate || new AudioContext().sampleRate
        };
        await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(info)), { reliable: true, topic: "studiolink-client-info" });
      } catch (e) { console.error(e); }
    })();
    return () => { active = false; room.off(RoomEvent.TrackPublished, onPublished); room.off(RoomEvent.ParticipantConnected, refreshRemotes); room.off(RoomEvent.ParticipantDisconnected, refreshRemotes); room.off(RoomEvent.TrackSubscribed, refreshRemotes); room.disconnect(); };
  }, [room, token, choices.audioDeviceId, choices.videoDeviceId, choices.height, onRemoteChange]);
  return null;
}

export default function RoomPage() { return <Suspense fallback={<main><div className="panel">Загрузка комнаты…</div></main>}><RoomContent /></Suspense>; }
