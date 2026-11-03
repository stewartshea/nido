// One definition of the app's navigation.
//
// The header and the mobile bottom bar used to carry their own hardcoded lists,
// so adding a destination meant editing two places and one of them was easy to
// forget. Both surfaces read this instead.
import { LayoutDashboard, Users, Package, Home, Bell, Wrench, ChartLine } from 'lucide-svelte';

export interface NavItem {
	id: string;
	label: string;
	href: string;
	icon: typeof LayoutDashboard;
}

/** Destinations reachable from both the header and the bottom bar. */
export const PRIMARY_NAV: NavItem[] = [
	{ id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
	{ id: 'reports', label: 'Reports', href: '/reports', icon: ChartLine },
	{ id: 'family', label: 'Family', href: '/family', icon: Users },
	{ id: 'home', label: 'Home', href: '/home', icon: Home },
	{ id: 'inventory', label: 'Inventory', href: '/inventory', icon: Package },
	{ id: 'assets', label: 'Assets', href: '/assets', icon: Wrench },
	{ id: 'notifications', label: 'Notifications', href: '/notifications', icon: Bell },
];

/**
 * The bottom bar mirrors the header. Settings is deliberately not repeated
 * here: six items crowds a 390px bar, and the account menu in the header
 * already carries it on every screen size. Assets and Reports are header-only
 * for the same reason — one is a set-up surface, the other a look-back, and
 * neither is the daily loop the bar is for.
 */
export const BOTTOM_NAV: NavItem[] = PRIMARY_NAV.filter((item) => item.id !== 'assets' && item.id !== 'reports');
