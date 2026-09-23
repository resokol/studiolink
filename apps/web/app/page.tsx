"use client";

import { useState } from "react";

export default function HomePage() {
  const [roomName, setRoomName] = useState("demo-room");
  const [role, setRole] = useState<"guest" | "studio">("guest");

  return (
    <main>
      <div className="stack">
        <div>
          <p className="muted">StudioLink v0.1</p>
          <h1>Remote production, built for your studio.</h1>
          <p className="muted">
            Первый прототип платформы для удалённых гостей и интеграции с vMix.
          </p>
        </div>

        <section className="panel stack">
          <h2>Подключиться к комнате</h2>
          <label htmlFor="room">Название комнаты</label>
          <input id="room" value={roomName} onChange={(e) => setRoomName(e.target.value)} />

          <div className="stack">
            <label>
              <input
                type="radio"
                checked={role === "guest"}
                onChange={() => setRole("guest")}
                style={{ width: "auto", marginRight: 8 }}
              />
              Гость
            </label>
            <label>
              <input
                type="radio"
                checked={role === "studio"}
                onChange={() => setRole("studio")}
                style={{ width: "auto", marginRight: 8 }}
              />
              Студия
            </label>
          </div>

          <button
            disabled={!roomName.trim()}
            onClick={() => {
              window.location.href = `/room?name=${encodeURIComponent(roomName)}&role=${role}`;
            }}
          >
            Продолжить
          </button>
        </section>
      </div>
    </main>
  );
}
