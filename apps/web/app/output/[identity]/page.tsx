"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";

export default function OutputPage() {
  const { identity } = useParams<{ identity: string }>();
  const search = useSearchParams();
  const roomName = search.get("room") || "demo-room";
  const videoRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Подключение…");

  useEffect(() => {
    const room = new Room({ adaptiveStream: true, dynacast: true });

    const attach = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (participant.identity !== identity) return;
      const element = track.attach();
      element.autoplay = true;
      if (track.kind === Track.Kind.Video) {
        videoRef.current?.replaceChildren(element);
        setStatus("");
      } else if (track.kind === Track.Kind.Audio) {
        audioRef.current?.appendChild(element);
      }
    };

    room.on(RoomEvent.TrackSubscribed, attach);
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (participant.identity === identity) setStatus("Гость отключился");
    });

    (async () => {
      try {
        const response = await fetch(`/api/token?room=${encodeURIComponent(roomName)}&identity=${encodeURIComponent(`output-${crypto.randomUUID()}`)}&role=output`);
        if (!response.ok) throw new Error(await response.text());
        const { token } = await response.json();
        await room.connect(process.env.NEXT_PUBLIC_LIVEKIT_URL!, token);
        await room.startAudio().catch(() => undefined);
        const participant = room.remoteParticipants.get(identity);
        if (!participant) setStatus("Ожидание гостя…");
        else {
          for (const publication of participant.trackPublications.values()) {
            if (publication.track) attach(publication.track, publication, participant);
          }
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Ошибка подключения");
      }
    })();

    return () => { room.disconnect(); };
  }, [identity, roomName]);

  return (
    <main className="output-page">
      <div ref={videoRef} className="output-video" />
      <div ref={audioRef} className="output-audio" />
      {status && <div className="output-status">{status}</div>}
    </main>
  );
}
