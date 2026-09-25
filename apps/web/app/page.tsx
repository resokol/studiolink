"use client";

import { useState } from "react";

export default function HomePage() {
  const [roomName, setRoomName] = useState("demo-room");

  return (
    <main>
      <div className="stack">
        <div>
          <p className="muted">StudioLink v0.1</p>
          <h1>Remote production, built for your studio.</h1>
          <p className="muted">Подключение удалённого гостя к StudioLink.</p>
        </div>
        <section className="panel stack">
          <h2>Подключиться к комнате</h2>
          <label htmlFor="room">Комната</label>
          <input id="room" value={roomName} onChange={(e) => setRoomName(e.target.value)} />
          <button disabled={!roomName.trim()} onClick={() => { window.location.href = `/room?name=${encodeURIComponent(roomName.trim())}`; }}>
            Подключиться как гость
          </button>
        </section>
      </div>
    </main>
  );
}
