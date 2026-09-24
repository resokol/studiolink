import { AccessToken } from "livekit-server-sdk";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const room = request.nextUrl.searchParams.get("room") || "demo-room";
  const identity = request.nextUrl.searchParams.get("identity") || `user-${Date.now()}`;
  const role = request.nextUrl.searchParams.get("role");
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    return NextResponse.json({ error: "LiveKit credentials are not configured" }, { status: 500 });
  }

  const token = new AccessToken(apiKey, apiSecret, { identity, ttl: "2h" });
  token.addGrant({
    roomJoin: true,
    room,
    canPublish: role !== "output",
    canSubscribe: true,
  });

  return NextResponse.json({ token: await token.toJwt() });
}
