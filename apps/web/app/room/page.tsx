"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  LiveKitRoom,
  PreJoin,
  VideoConference,
  type LocalUserChoices,
} from "@livekit/components-react";

function RoomContent() {
  const params = useSearchParams();
  const room = params.get("name") || "demo-room";
  const [token, setToken] = useState<string>();
  const [error, setError] = useState<string>();
  const [userChoices, setUserChoices] = useState<LocalUserChoices>();

  useEffect(() => {
    fetch(
      `/api/token?room=${encodeURIComponent(room)}&identity=${encodeURIComponent(
        `user-${Math.random().toString(36).slice(2, 8)}`
      )}`
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      })
      .then((data) => setToken(data.token))
      .catch((err) => setError(err.message));
  }, [room]);

  if (error) return <main><div className="panel">Ошибка: {error}</div></main>;
  if (!token) return <main><div className="panel">Подключение к комнате…</div></main>;

  if (!userChoices) {
    return (
      <main>
        <h1>{room}</h1>
        <PreJoin
          joinLabel="Войти в комнату"
          micLabel="Микрофон"
          camLabel="Камера"
          persistUserChoices
          onSubmit={setUserChoices}
          onError={(err) => setError(err.message)}
        />
      </main>
    );
  }

  return (
    <main>
      <h1>{room}</h1>
      <LiveKitRoom
        token={token}
        serverUrl={process.env.NEXT_PUBLIC_LIVEKIT_URL}
        connect
        audio={userChoices.audioEnabled ? { deviceId: userChoices.audioDeviceId } : false}
        video={userChoices.videoEnabled ? { deviceId: userChoices.videoDeviceId } : false}
      >
        <VideoConference />
      </LiveKitRoom>
    </main>
  );
}

export default function RoomPage() {
  return (
    <Suspense fallback={<main><div className="panel">Загрузка комнаты…</div></main>}>
      <RoomContent />
    </Suspense>
  );
}
