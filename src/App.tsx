import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import MapPage from "./MapPage";
import TestPage from "./TestPage";

const rootRoute = createRootRoute({
	component: () => <Outlet />,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: MapPage,
});

const testRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/test",
	component: TestPage,
});

const routeTree = rootRoute.addChildren([indexRoute, testRoute]);

const router = createRouter({routeTree});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

function App() {
	return <RouterProvider router={router} />;
}

export default App;
