#include <windows.h>
#include <objbase.h>
#include <winhttp.h>
#include <atomic>
#include <cmath>
#include <mutex>
#include <memory>
#include <string>
#include <thread>
#include <vector>
#include "livekit/livekit.h"

static HWND g_status = nullptr;
static HWND g_room = nullptr;
static HWND g_name = nullptr;
static std::unique_ptr<livekit::Room> g_livekit_room;
static std::atomic<bool> g_connecting{false};
static std::atomic<bool> g_meter_running{false};
static std::shared_ptr<livekit::AudioStream> g_audio_stream;

static void SetStatus(const std::wstring& text) {
  if (g_status) SetWindowTextW(g_status, text.c_str());
}

static std::string WideToUtf8(const std::wstring& value) {
  if (value.empty()) return {};
  int size = WideCharToMultiByte(CP_UTF8,0,value.c_str(),(int)value.size(),nullptr,0,nullptr,nullptr);
  std::string out(size,0);
  WideCharToMultiByte(CP_UTF8,0,value.c_str(),(int)value.size(),out.data(),size,nullptr,nullptr);
  return out;
}

static std::wstring ReadText(HWND edit) {
  int n=GetWindowTextLengthW(edit);
  std::wstring s(n,L'\0');
  GetWindowTextW(edit,s.data(),n+1);
  return s;
}

static std::string HttpGet(const std::wstring& host, INTERNET_PORT port, const std::wstring& path) {
  HINTERNET ses=WinHttpOpen(L"StudioLink/0.2",WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,WINHTTP_NO_PROXY_NAME,WINHTTP_NO_PROXY_BYPASS,0);
  if(!ses) return {};
  HINTERNET con=WinHttpConnect(ses,host.c_str(),port,0);
  HINTERNET req=con?WinHttpOpenRequest(con,L"GET",path.c_str(),nullptr,WINHTTP_NO_REFERER,WINHTTP_DEFAULT_ACCEPT_TYPES,WINHTTP_FLAG_SECURE):nullptr;
  if(req) {
    DWORD flags=SECURITY_FLAG_IGNORE_UNKNOWN_CA|SECURITY_FLAG_IGNORE_CERT_CN_INVALID|SECURITY_FLAG_IGNORE_CERT_DATE_INVALID|SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
    WinHttpSetOption(req,WINHTTP_OPTION_SECURITY_FLAGS,&flags,sizeof(flags));
  }
  std::string body;
  if(req && WinHttpSendRequest(req,WINHTTP_NO_ADDITIONAL_HEADERS,0,WINHTTP_NO_REQUEST_DATA,0,0,0) && WinHttpReceiveResponse(req,nullptr)) {
    for(;;) {
      DWORD avail=0; if(!WinHttpQueryDataAvailable(req,&avail)||!avail) break;
      std::vector<char> buf(avail); DWORD got=0;
      if(!WinHttpReadData(req,buf.data(),avail,&got)) break;
      body.append(buf.data(),got);
    }
  }
  if(req) WinHttpCloseHandle(req); if(con) WinHttpCloseHandle(con); WinHttpCloseHandle(ses);
  return body;
}

static std::string JsonString(const std::string& json,const std::string& key) {
  std::string needle="\""+key+"\":\""; auto p=json.find(needle); if(p==std::string::npos) return {};
  p+=needle.size(); auto e=json.find('"',p); return e==std::string::npos?std::string{}:json.substr(p,e-p);
}

static void StartPcmMeter(HWND hwnd) {
  if (g_meter_running.exchange(true)) return;
  std::thread([hwnd] {
    std::shared_ptr<livekit::Track> audioTrack;
    std::string who;
    if (g_livekit_room) {
      for (auto& weak : g_livekit_room->remoteParticipants()) {
        if (auto p = weak.lock()) {
          for (const auto& kv : p->trackPublications()) {
            const auto& pub = kv.second;
            if (pub && pub->kind() == livekit::TrackKind::KIND_AUDIO && pub->track()) {
              audioTrack = pub->track();
              who = p->identity();
              break;
            }
          }
        }
        if (audioTrack) break;
      }
    }
    if (!audioTrack) {
      PostMessageW(hwnd, WM_APP+1, 0, (LPARAM)new std::wstring(L"CONNECTED - waiting for subscribed audio track"));
      g_meter_running = false;
      return;
    }
    livekit::AudioStream::Options opts;
    opts.capacity = 2;
    g_audio_stream = livekit::AudioStream::fromTrack(audioTrack, opts);
    livekit::AudioFrameEvent ev;
    while (g_audio_stream && g_audio_stream->read(ev)) {
      const auto& pcm = ev.frame.data();
      if (pcm.empty()) continue;
      long double sum = 0.0;
      for (auto s : pcm) {
        const long double v = (long double)s / 32768.0L;
        sum += v * v;
      }
      const double rms = std::sqrt((double)(sum / pcm.size()));
      const double db = rms > 0.000001 ? 20.0 * std::log10(rms) : -120.0;
      wchar_t text[256];
      swprintf_s(text, L"PCM LIVE  %hs  |  %.1f dBFS  |  %d Hz / %d ch / %d samples",
        who.c_str(), db, ev.frame.sampleRate(), ev.frame.numChannels(), ev.frame.samplesPerChannel());
      PostMessageW(hwnd, WM_APP+1, 0, (LPARAM)new std::wstring(text));
    }
    g_meter_running = false;
  }).detach();
}

static void ConnectNative(HWND hwnd) {
  if(g_connecting.exchange(true)) return;
  SetStatus(L"Connecting natively to LiveKit...");
  std::wstring room=ReadText(g_room), name=ReadText(g_name);
  std::thread([hwnd,room,name]{
    std::wstring path=L"/api/token?room="+room+L"&name="+name+L"&identity=studio-native&role=monitor";
    std::string json=HttpGet(L"192.168.53.68",443,path);
    std::string token=JsonString(json,"token");
    if(token.empty()) { PostMessageW(hwnd,WM_APP+1,0,(LPARAM)new std::wstring(L"Token request failed")); g_connecting=false; return; }
    try {
      livekit::initialize(livekit::LogLevel::Info);
      auto r=std::make_unique<livekit::Room>();
      livekit::RoomOptions options; options.auto_subscribe=true;
      bool ok=r->connect("ws://192.168.53.68:7880",token,options);
      if(ok) {
        auto count=r->remoteParticipants().size();
        g_livekit_room=std::move(r);
        PostMessageW(hwnd,WM_APP+1,0,(LPARAM)new std::wstring(L"CONNECTED - remote participants: "+std::to_wstring(count)));
        std::this_thread::sleep_for(std::chrono::milliseconds(500));
        StartPcmMeter(hwnd);
      } else PostMessageW(hwnd,WM_APP+1,0,(LPARAM)new std::wstring(L"LiveKit connect failed (LAN ws://192.168.53.68:7880)"));
    } catch(...) { PostMessageW(hwnd,WM_APP+1,0,(LPARAM)new std::wstring(L"LiveKit exception")); }
    g_connecting=false;
  }).detach();
}

static LRESULT CALLBACK WindowProc(HWND hwnd,UINT msg,WPARAM wp,LPARAM lp) {
  if(msg==WM_CREATE) {
    CreateWindowW(L"STATIC",L"StudioLink Studio - native Windows / LiveKit C++",WS_CHILD|WS_VISIBLE,30,25,700,30,hwnd,nullptr,nullptr,nullptr);
    CreateWindowW(L"STATIC",L"Room:",WS_CHILD|WS_VISIBLE,30,80,80,25,hwnd,nullptr,nullptr,nullptr);
    g_room=CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",L"test-room",WS_CHILD|WS_VISIBLE|ES_AUTOHSCROLL,110,75,300,30,hwnd,nullptr,nullptr,nullptr);
    CreateWindowW(L"STATIC",L"Name:",WS_CHILD|WS_VISIBLE,30,125,80,25,hwnd,nullptr,nullptr,nullptr);
    g_name=CreateWindowExW(WS_EX_CLIENTEDGE,L"EDIT",L"Windows Studio",WS_CHILD|WS_VISIBLE|ES_AUTOHSCROLL,110,120,300,30,hwnd,nullptr,nullptr,nullptr);
    CreateWindowW(L"BUTTON",L"CONNECT",WS_CHILD|WS_VISIBLE|BS_PUSHBUTTON,110,175,180,42,hwnd,(HMENU)100,nullptr,nullptr);
    g_status=CreateWindowW(L"STATIC",L"Ready. Native SDK 1.12.0",WS_CHILD|WS_VISIBLE,30,245,900,35,hwnd,nullptr,nullptr,nullptr);
    return 0;
  }
  if(msg==WM_COMMAND && LOWORD(wp)==100) { ConnectNative(hwnd); return 0; }
  if(msg==WM_APP+1) { auto* s=(std::wstring*)lp; SetStatus(*s); delete s; return 0; }
  if(msg==WM_DESTROY) { if(g_audio_stream) g_audio_stream->close(); g_audio_stream.reset(); g_livekit_room.reset(); livekit::shutdown(); PostQuitMessage(0); return 0; }
  return DefWindowProc(hwnd,msg,wp,lp);
}

int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR,int show) {
  CoInitializeEx(nullptr,COINIT_MULTITHREADED);
  const wchar_t cls[]=L"StudioLinkStudioWindow";
  WNDCLASS wc{}; wc.lpfnWndProc=WindowProc; wc.hInstance=instance; wc.lpszClassName=cls; wc.hCursor=LoadCursor(nullptr,IDC_ARROW); wc.hbrBackground=(HBRUSH)(COLOR_WINDOW+1);
  RegisterClass(&wc);
  HWND hwnd=CreateWindowEx(0,cls,L"StudioLink Studio - Native Windows",WS_OVERLAPPEDWINDOW,CW_USEDEFAULT,CW_USEDEFAULT,1100,650,nullptr,nullptr,instance,nullptr);
  if(!hwnd) return 1; ShowWindow(hwnd,show);
  MSG msg{}; while(GetMessage(&msg,nullptr,0,0)>0){TranslateMessage(&msg);DispatchMessage(&msg);}
  CoUninitialize(); return 0;
}
