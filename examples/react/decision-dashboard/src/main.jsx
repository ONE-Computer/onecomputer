import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main>
      <section className="hero">
        <div className="pill">OneComputer React Static</div>
        <h1>Decision Dashboard</h1>
        <p>
          Governed React deployment proof for small shadow apps that do not need
          a server.
        </p>
        <div className="grid">
          <div>
            <b>Runtime</b>
            <span>Nginx static</span>
          </div>
          <div>
            <b>Access</b>
            <span>OneComputer sandbox gate</span>
          </div>
          <div>
            <b>Users</b>
            <span>5-10 named users</span>
          </div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
