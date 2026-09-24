[Reading 378 lines from line 1 (total: 379 lines, 0 remaining)]


import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AudioPresets, Room, RoomEvent, Track, type RemoteAudioTrack, type RemoteTrackPublication } from "livekit-client";

type GuestStat = {
  identity: string;
  name: string;
  resolution: string;
  bitrateKbps: number;
  packetLoss: number;
  jitterMs: number;
  rttMs: number;
  stability: "Хорошая" | "Средняя" | "Плохая";
  camera: boolean;
  microphone: boolean;
  cameraDevice?: string;
  cpu?: string;
  gpu?: string;
  platform?: string;
  sampleRate?: number;
  signalLevel?: number;
  signalDb?: number;
};

function StudioContent() {
  const params = useSearchParams();
  const roomName = params.get("room") || "demo-room";
  const [room] = useState(() => new Room({ adaptiveStream: false, dynacast: false }));
  const [status, setStatus] = useState("Подключение…");
  const [guests, setGuests] = useState<GuestStat[]>([]);
  const [copied, setCopied] = useState<string>();
  const [receiveSettings, setReceiveSettings] = useState<Record<string, number>>({});
  const [guestVolumes, setGuestVolumes] = useState<Record<string, number>>({});
  const [guestMuted, setGuestMuted] = useState<Record<string, boolean>>({});
  const [returnStats, setReturnStats] = useState({ resolution: "—", videoKbps: 0, audioKbps: 0, fps: 0 });
  const returnPrevStats = useRef({ videoBytes: 0, audioBytes: 0, ts: 0 });
  const clientInfoRef = useRef<Record<string, { camera?: string; cpu?: string; gpu?: string; platform?: string; sampleRate?: number }>>({});
  const [returnVideoDevice, setReturnVideoDevice] = useState("");
  const [returnAudioDevice, setReturnAudioDevice] = useState("");
  const [returnDevices, setReturnDevices] = useState<MediaDeviceInfo[]>([]);
  const [returnLevel, setReturnLevel] = useState(-60);
  const [returnGain, setReturnGain] = useState(100);
  const returnGainNodeRef = useRef<GainNode | undefined>(undefined);
  const [returnActive, setReturnActive] = useState(false);
  const [onAir, setOnAir] = useState(false);
  const onAirRef = useRef(false);
  const [onAirStatus, setOnAirStatus] = useState("OFF AIR");
  const returnVideoRef = useRef<HTMLVideoElement>(null);
  const guestVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const returnStreamRef = useRef<MediaStream | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const previous = new Map<string, { bytes: number; ts: number }>();

    const refresh = async () => {
      const rows: GuestStat[] = [];
      for (const participant of room.remoteParticipants.values()) {
        if (!participant.identity.startsWith("guest-")) continue;
        const cameraPub = participant.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined;
        const micPub = participant.getTrackPublication(Track.Source.Microphone) as RemoteTrackPublication | undefined;
        let resolution = "—";
        let bitrateKbps = 0;
        let packetLoss = 0;
        let jitterMs = 0;
        let rttMs = 0;
        let signalDb = -60;
        let signalLevel = 0;

        if (cameraPub?.track) {
          const report = await cameraPub.track.getRTCStatsReport();
          report?.forEach((stat) => {
            if (stat.type === "inbound-rtp" && stat.kind === "video") {
              if (stat.frameWidth && stat.frameHeight) resolution = `${stat.frameWidth}×${stat.frameHeight}`;
              const prev = previous.get(participant.identity);
              if (prev && stat.timestamp > prev.ts) {
                bitrateKbps = Math.max(0, Math.round(((stat.bytesReceived - prev.bytes) * 8) / (stat.timestamp - prev.ts)));
              }
              previous.set(participant.identity, { bytes: stat.bytesReceived || 0, ts: stat.timestamp });
              packetLoss = Math.max(0, stat.packetsLost || 0);
              jitterMs = Math.round((stat.jitter || 0) * 1000);
            }
            if (stat.type === "remote-inbound-rtp" && stat.kind === "video") {
              rttMs = Math.round((stat.roundTripTime || 0) * 1000);
            }
          });
        }

        if (micPub?.track) {
          const audioReport = await micPub.track.getRTCStatsReport();
          audioReport?.forEach((stat) => {
            if (stat.type === "inbound-rtp" && stat.kind === "audio") {
              const linear = Number(stat.audioLevel || 0);
              if (linear > 0) {
                signalDb = Math.max(-60, Math.min(0, 20 * Math.log10(linear)));
                signalLevel = Math.round(Math.max(0, Math.min(100, (signalDb + 60) / 60 * 100)));
              }
            }
          });
        }

        const stability: GuestStat["stability"] =
          packetLoss > 10 || jitterMs > 60 || rttMs > 300 ? "Плохая" :
          packetLoss > 2 || jitterMs > 30 || rttMs > 150 ? "Средняя" : "Хорошая";

        rows.push({
          identity: participant.identity,
          name: participant.name || participant.identity.replace(/^guest-/, ""),
          resolution,
          bitrateKbps,
          packetLoss,
          jitterMs,
          rttMs,
          stability,
          camera: !!cameraPub && !cameraPub.isMuted,
          microphone: !!micPub && !micPub.isMuted,
          cameraDevice: clientInfoRef.current[participant.identity]?.camera,
          cpu: clientInfoRef.current[participant.identity]?.cpu,
          gpu: clientInfoRef.current[participant.identity]?.gpu,
          platform: clientInfoRef.current[participant.identity]?.platform,
          sampleRate: clientInfoRef.current[participant.identity]?.sampleRate,
          signalLevel,
          signalDb,
        });
      }
      if (onAir) {
        const cameraPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
        const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
        const videoTrack = cameraPub?.track;
        const audioTrack = micPub?.track;
        let resolution = "—", videoKbps = 0, audioKbps = 0, videoBytes = 0, audioBytes = 0, fps = 0, packets = 0, ts = performance.now();
        if (videoTrack && "getSenderStats" in videoTrack) {
          const stats = await (videoTrack as any).getSenderStats();
          const list = Array.isArray(stats) ? stats : stats ? [stats] : [];
          const s = list.find((x: any) => x.frameWidth && x.frameHeight) || list[0];
          if (s) { resolution = s.frameWidth && s.frameHeight ? `${s.frameWidth}×${s.frameHeight}` : resolution; fps = s.framesPerSecond || 0; }
          videoBytes = list.reduce((sum: number, x: any) => sum + (x.bytesSent || 0), 0);
          if (resolution === "—") { const ms = returnStreamRef.current?.getVideoTracks()[0]?.getSettings(); if (ms?.width && ms?.height) resolution = `${ms.width}×${ms.height}`; }
        }
        if (audioTrack && "getSenderStats" in audioTrack) {
          const s = await (audioTrack as any).getSenderStats();
          if (s) audioBytes = s.bytesSent || 0;
        }
        if (!videoBytes && videoTrack && "getRTCStatsReport" in videoTrack) {
          const raw = await (videoTrack as any).getRTCStatsReport();
          raw?.forEach((s: any) => {
            if (s.type === "outbound-rtp" && !s.isRemote && (s.kind === "video" || s.mediaType === "video")) {
              videoBytes += Number(s.bytesSent || 0);
              fps = Number(s.framesPerSecond || fps);
              if (s.frameWidth && s.frameHeight) resolution = String(s.frameWidth) + "×" + String(s.frameHeight);
            }
          });
        }
        if (!audioBytes && audioTrack && "getRTCStatsReport" in audioTrack) {
          const raw = await (audioTrack as any).getRTCStatsReport();
          raw?.forEach((s: any) => {
            if (s.type === "outbound-rtp" && !s.isRemote && (s.kind === "audio" || s.mediaType === "audio")) audioBytes += Number(s.bytesSent || 0);
          });
        }
        const prev = returnPrevStats.current;
        if (prev.ts && ts > prev.ts) {
          videoKbps = Math.max(0, Math.round((videoBytes - prev.videoBytes) * 8 / (ts - prev.ts)));
          audioKbps = Math.max(0, Math.round((audioBytes - prev.audioBytes) * 8 / (ts - prev.ts)));
        }
        returnPrevStats.current = { videoBytes, audioBytes, ts };
        if (!cancelled) setReturnStats({ resolution, videoKbps, audioKbps, fps });
      } else if (!cancelled) setReturnStats({ resolution: "—", videoKbps: 0, audioKbps: 0, fps: 0 });
      if (!cancelled) setGuests(rows);
    };

    (async () => {
      try {
        const identity = `studio-panel-${crypto.randomUUID()}`;
        const response = await fetch(`/api/token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(identity)}&name=Studio%20Panel&role=studio-panel`);
        if (!response.ok) throw new Error(await response.text());
        const { token } = await response.json();
        await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token);
        if (!cancelled) setStatus("Онлайн");
        await refresh();
        timer = setInterval(refresh, 2000);
      } catch (error) {
        if (!cancelled) setStatus(error instanceof Error ? error.message : "Ошибка подключения");
      }
    })();

    const update = () => void refresh();
    room.on(RoomEvent.ParticipantConnected, update);
    room.on(RoomEvent.ParticipantDisconnected, update);
    room.on(RoomEvent.TrackPublished, update);
    room.on(RoomEvent.TrackUnpublished, update);
    room.on(RoomEvent.TrackMuted, update);
    room.on(RoomEvent.TrackUnmuted, update);
    const onData = (payload: Uint8Array, participant?: { identity: string }, _kind?: unknown, topic?: string) => {
      if (topic !== "studiolink-client-info" || !participant?.identity.startsWith("guest-")) return;
      try { clientInfoRef.current[participant.identity] = JSON.parse(new TextDecoder().decode(payload)); void refresh(); } catch {}
    };
    room.on(RoomEvent.DataReceived, onData);
    const attachGuestVideo = (track: any, _pub: RemoteTrackPublication, participant: { identity: string }) => {
      if (!participant.identity.startsWith("guest-") || track.kind !== Track.Kind.Video) return;
      const el = guestVideoRefs.current[participant.identity];
      if (el) track.attach(el);
    };
    room.on(RoomEvent.TrackSubscribed, attachGuestVideo);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      room.off(RoomEvent.TrackSubscribed, attachGuestVideo);
      room.off(RoomEvent.DataReceived, onData);
      room.disconnect();
    };
  }, [room, roomName]);

  useEffect(() => {
    if (!returnActive) return;
    let cancelled = false;
    let raf = 0;
    let ctx: AudioContext | undefined;
    (async () => {
      try {
        returnStreamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: returnVideoDevice ? { deviceId: { exact: returnVideoDevice }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } : { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
          audio: returnAudioDevice ? { deviceId: { exact: returnAudioDevice }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } } : { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        returnStreamRef.current = stream;
        if (returnVideoRef.current) { returnVideoRef.current.srcObject = stream; await returnVideoRef.current.play().catch(() => undefined); }
        const devices = await navigator.mediaDevices.enumerateDevices();
        setReturnDevices(devices);
        const a = stream.getAudioTracks()[0]?.getSettings().deviceId || "";
        const v = stream.getVideoTracks()[0]?.getSettings().deviceId || "";
        if (!returnAudioDevice && a) setReturnAudioDevice(a);
        if (!returnVideoDevice && v) setReturnVideoDevice(v);
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        const source = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
        const gain = ctx.createGain();
        gain.gain.value = returnGain / 100;
        returnGainNodeRef.current = gain;
        const destination = ctx.createMediaStreamDestination();
        source.connect(gain);
        gain.connect(analyser);
        gain.connect(destination);
        const processedAudio = destination.stream.getAudioTracks()[0];
        stream.removeTrack(stream.getAudioTracks()[0]);
        stream.addTrack(processedAudio);
        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(data);
          let peak = 0;
          for (const sample of data) peak = Math.max(peak, Math.abs(sample));
          const db = peak > 0 ? 20 * Math.log10(peak) : -60;
          setReturnLevel(Math.max(-60, Math.min(0, Math.round(db * 10) / 10)));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) { console.error("Studio return preview failed", e); }
    })();
    return () => { cancelled = true; cancelAnimationFrame(raf); returnStreamRef.current?.getTracks().forEach((t) => t.stop()); void ctx?.close().catch(() => undefined); };
  }, [returnActive, returnVideoDevice, returnAudioDevice]);

  useEffect(() => { if (returnGainNodeRef.current) returnGainNodeRef.current.gain.value = returnGain / 100; }, [returnGain]);

  const toggleOnAir = async () => {
    try {
      const stream = returnStreamRef.current;
      if (!stream) return;
      if (onAir) {
        for (const publication of room.localParticipant.trackPublications.values()) {
          if (publication.track) await room.localParticipant.unpublishTrack(publication.track, false);
        }
        onAirRef.current = false;
        setOnAir(false);
        setOnAirStatus("OFF AIR");
        return;
      }
      const video = stream.getVideoTracks()[0];
      const audio = stream.getAudioTracks()[0];
      if (!video || !audio) throw new Error("Нет видео или аудио Studio Return");
      await room.localParticipant.publishTrack(video, { source: Track.Source.Camera, name: "Studio Return Video", simulcast: false, videoEncoding: { maxBitrate: 8_000_000, maxFramerate: 30 }, degradationPreference: "maintain-resolution" });
      await room.localParticipant.publishTrack(audio, { source: Track.Source.Microphone, name: "Studio Return Audio", audioPreset: AudioPresets.musicHighQualityStereo, dtx: false, red: true });
      onAirRef.current = true;
      setOnAir(true);
      setOnAirStatus("ON AIR");
    } catch (e) {
      console.error("Studio Return publish failed", e);
      setOnAirStatus("Ошибка публикации");
    }
  };

  const base = typeof window === "undefined" ? "" : window.location.origin;
  const outputUrl = (identity: string) => `${base}/output/${encodeURIComponent(identity)}?room=${encodeURIComponent(roomName)}&bitrate=${receiveFor(identity)}`;
  const receiveFor = (identity: string) => receiveSettings[identity] || 2500;
  const applyReceiveQuality = (identity: string, bitrateKbps: number) => {
    const participant = room.remoteParticipants.get(identity);
    const publication = participant?.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication | undefined;
    if (!publication) return;
    // LiveKit simulcast exposes discrete layers rather than an arbitrary subscriber bitrate.
    // Map the requested receive budget to the highest sensible layer.
    if (bitrateKbps <= 750) {
      publication.setVideoDimensions({ width: 320, height: 180 });
    } else if (bitrateKbps <= 1800) {
      publication.setVideoDimensions({ width: 640, height: 360 });
    } else if (bitrateKbps <= 3000) {
      publication.setVideoDimensions({ width: 1280, height: 720 });
    } else {
      publication.setVideoDimensions({ width: 1920, height: 1080 });
    }
    setReceiveSettings((s) => ({ ...s, [identity]: bitrateKbps }));
    void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ target: identity, bitrateKbps })), { reliable: true, topic: "studiolink-output-quality" });
  };

  return (
    <main>
      <div className="studio-header">
        <div><p className="muted">StudioLink · Studio Panel</p><h1>{roomName}</h1></div>
        <div className="status-pill">{status}</div>
      </div>
      <div className="panel return-panel">
        <div className="return-title"><div><h2>Studio Return <span className={`air-state ${onAir ? "air-live" : ""}`}>{onAirStatus}</span></h2><p className="muted">Предпросмотр видео и аудио, которые отправляются гостям.</p></div><div className="return-buttons"><button disabled={onAir} onClick={() => setReturnActive((v) => !v)}>{returnActive ? "Остановить проверку" : "Проверить Studio Return"}</button><button className={onAir ? "off-air-button" : "on-air-button"} disabled={!returnActive} onClick={() => void toggleOnAir()}>{onAir ? "OFF AIR" : "ON AIR"}</button></div></div>
        {returnActive && <div className="return-grid">
          <video ref={returnVideoRef} muted playsInline className="return-preview" />
          <div className="return-controls">
            <label>Видео<select value={returnVideoDevice} onChange={(e) => setReturnVideoDevice(e.target.value)}>{returnDevices.filter((d) => d.kind === "videoinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Видеоисточник"}</option>)}</select></label>
            <label>Аудио<select value={returnAudioDevice} onChange={(e) => setReturnAudioDevice(e.target.value)}>{returnDevices.filter((d) => d.kind === "audioinput").map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || "Аудиоисточник"}</option>)}</select></label>
            <div className="return-audio-meter">
              <div className="meter-label"><span>Studio Return</span><strong>{returnLevel.toFixed(1)} dBFS</strong></div>
              <div className="db-meter"><div className="db-meter-fill" style={{ width: `${Math.max(0, Math.min(100, (returnLevel + 60) / 60 * 100))}%` }} /></div>
              <div className="db-scale"><span>-60</span><span>-18</span><span>-10</span><span>0 dB</span></div>
              <div className="gain-control"><span>Gain</span><input type="range" min="0" max="200" value={returnGain} onChange={(e) => setReturnGain(Number(e.target.value))} /><strong>{returnGain}%</strong></div>
            </div>
            <p className="muted">ON AIR публикует выбранные видео и аудио в комнату как Studio Return. Локальное превью без звука, чтобы не создавать акустическую петлю.</p>
          </div>
        </div>}
      </div>
      <div className="panel return-stats"><strong>Исходящий поток студии</strong><span>Видео: {returnStats.resolution} · {returnStats.videoKbps} кбит/с · {returnStats.fps} fps</span><span>Аудио: {returnStats.audioKbps} кбит/с</span></div>
      <div className="panel">
        {guests.length === 0 ? <p className="muted">Подключённых гостей пока нет.</p> : (
          <div className="guest-table-wrap">
            <table className="guest-table">
              <thead><tr><th>Гость</th><th>Камера</th><th>Разрешение</th><th>Факт. битрейт</th><th>Сеть</th><th>RTT / jitter</th><th>Входящий поток</th><th>vMix</th></tr></thead>
              <tbody>{guests.map((g) => (
                <tr key={g.identity}>
                  <td><strong>{g.name}</strong><small>{g.identity}</small><small>Камера: {g.cameraDevice || "—"}</small><small>CPU: {g.cpu || "—"}</small><small>GPU: {g.gpu || "—"}</small><small>ОС: {g.platform || "—"}</small></td>
                  <td><div className="guest-preview-cell"><div className="studio-guest-video-wrap"><video autoPlay playsInline muted ref={(el) => { guestVideoRefs.current[g.identity] = el; if (el) { const p=room.remoteParticipants.get(g.identity); const pub=p?.getTrackPublication(Track.Source.Camera) as RemoteTrackPublication|undefined; if(pub?.track) pub.track.attach(el); } }} className="guest-mini-video" /><div className="studio-guest-hover"><button title="Звук" onClick={() => { const p=room.remoteParticipants.get(g.identity); const pub=Array.from(p?.trackPublications.values() || []).find((x)=>x.kind===Track.Kind.Audio); const t=pub?.track as RemoteAudioTrack|undefined; const next=!guestMuted[g.identity]; t?.setVolume(next?0:(guestVolumes[g.identity]??100)/100); setGuestMuted((s)=>({...s,[g.identity]:next})); void room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({type:"studio-monitor-mute",muted:next})),{reliable:true,destinationIdentities:[g.identity],topic:"studiolink-control"}); }}>{guestMuted[g.identity]?"🔇":"🔊"}</button><input title="Громкость гостя" type="range" min="0" max="100" value={guestVolumes[g.identity]??100} onChange={(e)=>{const v=Number(e.target.value);setGuestVolumes((s)=>({...s,[g.identity]:v}));const p=room.remoteParticipants.get(g.identity);const pub=Array.from(p?.trackPublications.values()||[]).find((x)=>x.kind===Track.Kind.Audio);if(pub?.track&&!guestMuted[g.identity])(pub.track as RemoteAudioTrack).setVolume(v/100);}}/><button title="Во весь экран" onClick={(e)=>void (e.currentTarget.closest(".studio-guest-video-wrap") as HTMLElement)?.requestFullscreen()}>⛶</button></div></div></div></td>
                  <td>{g.resolution}</td>
                  <td>{g.bitrateKbps ? `${g.bitrateKbps} кбит/с` : "—"}</td>
                  <td><span className={`net net-${g.stability === "Хорошая" ? "good" : g.stability === "Средняя" ? "mid" : "bad"}`}>{g.stability}</span></td>
                  <td><div className="detailed-net"><span>RTT: {g.rttMs || "—"} мс</span><span>Jitter: {g.jitterMs || "—"} мс</span><span>Потери: {g.packetLoss} пак.</span><span>Audio: {g.sampleRate ? `${g.sampleRate} Hz` : "—"}</span><span className="signal-row vdo-audio-level"><b>MIC</b><i className="signal-meter"><i style={{width:`${g.signalLevel || 0}%`}} /></i><strong>{typeof g.signalDb === "number" ? `${g.signalDb.toFixed(1)} dBFS` : "—"}</strong></span></div></td>
                  <td>
                    <div className="quality-controls">
                      <select value={receiveFor(g.identity)} onChange={(e) => applyReceiveQuality(g.identity, Number(e.target.value))}>
                        {[500, 750, 1000, 1500, 2000, 2500, 3000, 3500, 4000].map((v) => <option key={v} value={v}>{v}k</option>)}
                      </select>
                    </div>
                  </td>
                  <td className="actions">
                    <a className="button-link" href={outputUrl(g.identity)} target="_blank" rel="noreferrer">Открыть</a>
                    <button onClick={async () => { await navigator.clipboard.writeText(outputUrl(g.identity)); setCopied(g.identity); setTimeout(() => setCopied(undefined), 1200); }}>{copied === g.identity ? "Скопировано" : "Копировать URL"}</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted studio-note">Статистика обновляется каждые 2 секунды. Входящий лимит выбирает подходящий simulcast-слой для Studio Panel; фактический битрейт зависит от содержимого кадра и сети.</p>
    </main>
  );
}

export default function StudioPage() {
  return <Suspense fallback={<main><div className="panel">Загрузка Studio Panel…</div></main>}><StudioContent /></Suspense>;
}

[executed on device: user1-System-Product-Name (49c0e26e-09f4-4b4a-a98b-545df098ad43)]