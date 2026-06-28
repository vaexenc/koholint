import AnimPage from "@/pages/AnimPage";
import MapPage from "@/pages/MapPage";
import OnlineMapPage from "@/pages/OnlineMapPage";
import TestPage from "@/pages/TestPage";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";

const rootRoute = createRootRoute({
	component: () => <Outlet />,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: OnlineMapPage,
});

const offlineRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/offline",
	component: MapPage,
});

const testMapRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/test",
	component: () => <MapPage mapUrl="/maps/test-map.json" />,
});

const avatarRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/avatar",
	component: TestPage,
});

const animRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/anim",
	component: AnimPage,
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	offlineRoute,
	testMapRoute,
	avatarRoute,
	animRoute,
]);

const router = createRouter({routeTree});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const queryClient = new QueryClient();

function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}

export default App;
