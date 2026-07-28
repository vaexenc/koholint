import MapPage from "@/client/pages/MapPage";
import {NotFound} from "@/client/pages/NotFound";
import RootMapPage from "@/client/pages/RootMapPage";
import {preloadAvatarSprites} from "@/client/sprites";
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

// the test map is a development scratchpad. a production build registers no
// route for it at all, so /test falls through to the not-found page — and the
// bundler drops the branch along with it.
const devRoutes = import.meta.env.DEV
	? [
			createRoute({
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
			}),
	  ]
	: [];

const adminRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/admin",
	// split into its own chunk: the panel's markup is fetched when someone opens
	// the route, rather than shipped in the bundle every player downloads.
	component: lazyRouteComponent(() => import("@/client/pages/AdminPage")),
});

const routeTree = rootRoute.addChildren([indexRoute, adminRoute, ...devRoutes]);

const router = createRouter({routeTree, defaultNotFoundComponent: NotFound});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const queryClient = new QueryClient();

// kick off at module load so the sheets are (usually) decoded before the
// first world frame or avatar picker needs them.
preloadAvatarSprites();

function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}

export default App;
