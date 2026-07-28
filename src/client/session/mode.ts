// which world the map route is showing. the root route persists it, both map
// pages take it as a prop and the connection pill renders it — so it belongs to
// the app rather than to any one of them, and none has to import a leaf widget
// to name it.
export type Mode = "online" | "offline";
