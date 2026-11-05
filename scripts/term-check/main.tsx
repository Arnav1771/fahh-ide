import ReactDOM from "react-dom/client";
import { XtermPane } from "../../src/components/Terminal/XtermPane";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <XtermPane session={{ id: "s1", title: "t", profile: "bash", cwd: "/tmp" }} active onFocus={() => {}} />,
);
