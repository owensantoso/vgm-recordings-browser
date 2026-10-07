import { useEffect, useRef } from "react";
import { Gauge } from "lucide-react";

export function nextPlaybackRate(rate: number, direction: number, supported?: number[]) {
  if (supported?.length) {
    const rates = [...supported].filter(value => value >= .5 && value <= 2).sort((a, b) => a - b);
    return direction > 0 ? rates.find(value => value > rate + .001) ?? rate : rates.reverse().find(value => value < rate - .001) ?? rate;
  }
  return Math.max(.5, Math.min(2, Math.round((rate + Math.sign(direction) * .1) * 10) / 10));
}

export function SpeedControl({ rate, disabled, video, onStep, onToggle }: {
  rate: number;
  disabled: boolean;
  video: boolean;
  onStep(direction: number): void;
  onToggle(): void;
}) {
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      if (disabled || event.ctrlKey || !event.deltaY) return;
      event.preventDefault();
      onStep(-Math.sign(event.deltaY));
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [disabled, onStep]);
  return <button ref={button} className="speed-control" aria-label={`Playback speed ${Number(rate.toFixed(2))} times; toggle original speed`} aria-pressed={rate !== 1} disabled={disabled} onClick={onToggle} title={`Speed · scroll ${video ? "through YouTube's supported speeds" : "in 0.1× steps"}; click toggles 1×/last speed. [ and ] adjust; \\ toggles.`}>
    <Gauge size={14} aria-hidden="true" /><span>{Number(rate.toFixed(2))}×</span>
  </button>;
}
