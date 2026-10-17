/** Presentation reads the session's shared logical timer, including battle. */
export function drawStoryTimer(context, width, timer) {
  if (!timer?.visible) return;
  context.save(); context.font = 'bold 20px ui-monospace, monospace';
  context.textAlign = "right"; context.textBaseline = "top";
  context.fillStyle = "#fff"; context.shadowColor = "#000"; context.shadowBlur = 3;
  context.fillText(`${timer.minutes}:${String(timer.seconds).padStart(2, "0")}`, width - 20, 20);
  context.restore();
}
