"use client";
// A crash in one panel should cost you that panel, not the workspace.
//
// The Drawings stage carries a drawing viewer, a modelling studio and a takeoff
// register on one screen. Without a boundary, one bad render in any of them
// unmounts the entire route and Next shows "Application error: a client-side
// exception has occurred" on a white page — no project, no navigation, and no
// indication of which of the three broke or why. The estimator's read of it is
// "Preckon is down".
//
// So each panel is fenced. The rest of the stage keeps working, and the fenced
// one says what went wrong IN PLACE. That message is not decoration: a
// production React error reaches the console and nowhere else, and asking
// somebody to open devtools and read it back is a round trip that this saves.

import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** What broke, in the reader's terms — "The drawing viewer", not "SheetCanvas". */
  name: string;
}
interface State { message: string | null }

export class Boundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(err: unknown): State {
    return { message: err instanceof Error ? err.message : String(err) };
  }

  componentDidCatch(err: unknown) {
    // Still logged: the stack is in the console for anyone who wants it, and
    // the message on screen is only ever the summary.
    console.error("[preckon] panel crashed:", err);
  }

  render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="chead">
          <div>
            <h2>{this.props.name}</h2>
            <div className="csub">This panel stopped. The rest of the page is unaffected.</div>
          </div>
          <button className="mini sm" onClick={() => this.setState({ message: null })}>
            Try again
          </button>
        </div>
        <p className="csub mono" style={{ margin: 0, wordBreak: "break-word" }}>
          {this.state.message}
        </p>
      </div>
    );
  }
}
