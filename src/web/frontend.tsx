import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [status, setStatus] = useState<any>(null);
  const [trackUrl, setTrackUrl] = useState("");

  const fetchStatus = () => {
    fetch("/api/status")
      .then((res) => res.json())
      .then(setStatus)
      .catch(console.error);
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleStream = async () => {
    if (!trackUrl) return;
    try {
      await fetch("/api/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track: trackUrl }),
      });
      alert("Streaming job dispatched in background!");
      setTrackUrl("");
    } catch (e) {
      alert("Failed to start stream");
    }
  };

  return (
    <div style={{ fontFamily: "sans-serif", padding: "20px" }}>
      <h1>Soggfy Daemon</h1>
      
      <div style={{ marginBottom: "20px", padding: "10px", border: "1px solid #ccc" }}>
        <h2>Daemon Status</h2>
        {status ? (
          <pre>{JSON.stringify(status, null, 2)}</pre>
        ) : (
          <p>Loading status...</p>
        )}
      </div>

      <div style={{ padding: "10px", border: "1px solid #ccc" }}>
        <h2>Stream Track</h2>
        <input
          type="text"
          value={trackUrl}
          onChange={(e) => setTrackUrl(e.target.value)}
          placeholder="Spotify Track ID or URL"
          style={{ width: "300px", padding: "5px", marginRight: "10px" }}
        />
        <button onClick={handleStream} style={{ padding: "5px 10px" }}>Stream</button>
      </div>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}
