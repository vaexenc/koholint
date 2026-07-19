import {preloadAvatarSprites} from "@/components/avatar-picker/registry";
import MapPage from "@/pages/MapPage";
import RootMapPage from "@/pages/RootMapPage";
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
	component: RootMapPage,
});

const testMapRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/test",
	component: () => (
		<MapPage
			mapUrl="/maps/test-map.json"
			allowTeleport
			settingsScope="test"
			profileKey="koholint:test.profile"
		/>
	),
});

const routeTree = rootRoute.addChildren([indexRoute, testMapRoute]);

const router = createRouter({routeTree});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const queryClient = new QueryClient();

// kick off at module load so the sheets are (usually) decoded before the
// first world frame or avatar-picker mount needs them.
preloadAvatarSprites();

function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}

export default App;
