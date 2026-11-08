const root = document.getElementById("root");
root.textContent = `WebRTC is ${typeof window.RTCPeerConnection}`;

// For the test of what a press is to a frame (ADR-0078): the frame's own script notes whether the
// browser holds a press of the frame's recent, and opens a window as the frame's SDK does where
// there is one, and not otherwise; once on its own, six seconds after it loaded, past the time a
// press lasts, and whenever the console's page tells it to by a message.
const press = document.createElement("button");
press.id = "press";
press.textContent = "press";
document.body.append(press);
const tryToOpen = (noted) => {
  const active = navigator.userActivation?.isActive;
  root.dataset[noted] = String(active);
  if (active !== false) {
    window.open("https://example.com/", "_blank", "noopener,noreferrer");
  }
};
setTimeout(() => tryToOpen("load"), 6000);
window.addEventListener("message", (event) => {
  if (event.data === "open example") {
    tryToOpen("active");
  }
});
