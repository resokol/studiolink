import { NextRequest, NextResponse } from "next/server";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";

const dir = "/tmp/studiolink-moves";
const safe = (v:string) => Buffer.from(v).toString("base64url");

export async function GET(request: NextRequest) {
  const room=request.nextUrl.searchParams.get("room")||"";
  const identity=request.nextUrl.searchParams.get("identity")||"";
  if(!room||!identity) return NextResponse.json({});
  const file=path.join(dir,safe(room+"|"+identity));
  try {
    const raw=await readFile(file,"utf8");
    await unlink(file).catch(()=>{});
    const data=JSON.parse(raw);
    if(Date.now()-Number(data.createdAt)>30000) return NextResponse.json({});
    return NextResponse.json({targetRoom:data.targetRoom});
  } catch { return NextResponse.json({}); }
}
