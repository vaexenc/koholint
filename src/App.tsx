import {preloadAvatarSprites} from "@/components/avatar-picker/preload";
import {NotFound} from "@/components/NotFound";
import MapPage from "@/pages/MapPage";
import RootMapPage from "@/pages/RootMapPage";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {
	createRootRoute,
	createRoute,
	createRouter,
	lazyRouteComponent,
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

const adminRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/admin",
	// split into its own chunk: the panel's markup is fetched when someone opens
	// the route, rather than shipped in the bundle every player downloads.
	component: lazyRouteComponent(() => import("@/pages/AdminPage")),
});

const routeTree = rootRoute.addChildren([indexRoute, testMapRoute, adminRoute]);

const router = createRouter({routeTree, defaultNotFoundComponent: NotFound});

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
