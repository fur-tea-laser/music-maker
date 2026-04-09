import { render } from "preact";
import { MusicLoopApp } from "./components/MusicLoopApp.tsx";
import "./styles/global.scss"

const root = document.getElementById("app");
render(<MusicLoopApp />, root!);
