import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { LEAD_OPTIONS } from "@/components/jarvis/SidePanels";
import type { JarvisStore } from "@/lib/jarvis-storage";

type Device = { deviceId: string; label: string };

export function VoiceSettings({
  store,
  onPreview,
}: {
  store: JarvisStore;
  onPreview: (text: string) => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [micError, setMicError] = useState<string | null>(null);

  const loadDevices = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      setMicError("Microphone selection is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all
          .filter((d) => d.kind === "audioinput")
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
      );
      setMicError(null);
    } catch {
      setMicError("Allow microphone access to list input devices.");
    }
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const handler = () => void loadDevices();
    navigator.mediaDevices.addEventListener?.("devicechange", handler);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", handler);
  }, [loadDevices]);

  return (
    <Dialog onOpenChange={(open) => open && void loadDevices()}>
      <DialogTrigger asChild>
        <button
          className="flex items-center gap-2 rounded border border-border px-3 py-1.5 font-mono text-[0.65rem] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
          aria-label="Voice settings"
        >
          <Settings2 size={13} />
          Voice setup
        </button>
      </DialogTrigger>

      <DialogContent className="panel max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-sm uppercase tracking-[0.25em] text-primary">
            Voice Settings
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          <div className="space-y-2">
            <Label className="panel-title">Input device</Label>
            <select
              value={store.micDeviceId}
              onChange={(event) => store.setMicDeviceId(event.target.value)}
              className="w-full rounded border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/70"
            >
              <option value="">System default microphone</option>
              {devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
            {micError && (
              <p className="font-mono text-[0.65rem] uppercase tracking-widest text-accent">
                {micError}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="panel-title">Speech rate</Label>
              <span className="font-mono text-xs text-primary">
                {store.speechRate.toFixed(2)}x
              </span>
            </div>
            <Slider
              value={[store.speechRate]}
              min={0.5}
              max={2}
              step={0.05}
              onValueChange={([value]) => store.setSpeechRate(value ?? 1)}
            />
            <button
              type="button"
              onClick={() => onPreview("Voice calibration complete. I am at your service.")}
              className="rounded border border-border px-3 py-1.5 font-mono text-[0.6rem] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
            >
              Test voice
            </button>
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="panel-title">Spoken replies</Label>
                <p className="text-xs text-muted-foreground">Read answers aloud.</p>
              </div>
              <Switch checked={store.voiceEnabled} onCheckedChange={store.setVoiceEnabled} />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="panel-title">Require wake word</Label>
                <p className="text-xs text-muted-foreground">
                  {store.wakeWordRequired
                    ? "Only acts on speech after the wake word."
                    : "Acts on everything heard while listening."}
                </p>
              </div>
              <Switch
                checked={store.wakeWordRequired}
                onCheckedChange={store.setWakeWordRequired}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="panel-title">Confirm high-impact actions</Label>
                <p className="text-xs text-muted-foreground">
                  {store.confirmHighImpact
                    ? "Asks yes/no before deleting memories or changing settings."
                    : "Applies deletions and setting changes immediately."}
                </p>
              </div>
              <Switch
                checked={store.confirmHighImpact}
                onCheckedChange={store.setConfirmHighImpact}
              />
            </div>

            <div className="space-y-2">
              <Label className="panel-title">Appointment alerts</Label>
              <p className="text-xs text-muted-foreground">
                How far ahead new appointments alert you. Each appointment can be changed
                individually in the calendar.
              </p>
              <select
                value={store.eventLeadMinutes}
                onChange={(event) => store.setEventLeadMinutes(Number(event.target.value))}
                className="w-full rounded border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/70"
              >
                {LEAD_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} minutes before` : `${m / 60} hour${m > 60 ? "s" : ""} before`}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="panel-title">Wake word</Label>
              <input
                value={store.wakeWord}
                onChange={(event) => store.setWakeWord(event.target.value.toLowerCase())}
                disabled={!store.wakeWordRequired}
                className="w-full rounded border border-border bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/70 disabled:opacity-40"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
