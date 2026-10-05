// One definition of the app's navigation.
//
// The header and the mobile bottom bar used to carry their own hardcoded lists,
// so adding a destination meant editing two places and one of them was easy to
// forget. Both surfaces read this instead.
import { LayoutDashboard, Users, Package, Home, Bell } from 'lucide-svelte';

export interface NavItem {
	id: string;
	label: string;
	href: string;
	icon: typeof LayoutDashboard;
}

/** Destinations reachable from both the header and the bottom bar. */
export const PRIMARY_NAV: NavItem[] = [
	{ id: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
	{ id: 'family', label: 'Family', href: '/family', icon: Users },
	{ id: 'home', label: 'Home', href: '/home', icon: Home },
	{ id: 'inventory', label: 'Inventory', href: '/inventory', icon: Package },
	{ id: 'notifications', label: 'Notifications', href: '/notifications', icon: Bell },
];

/**
 * The bottom bar mirrors the header. Settings is deliberately not repeated
 * here: six items crowds a 390px bar, and the account menu in the header
 * already carries it on every screen size.
 */
export const BOTTOM_NAV: NavItem[] = PRIMARY_NAV;
