import MapPage from "@/pages/MapPage";
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

const queryClient = new QueryClient();

function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
}

export default App;
