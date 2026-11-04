// One definition of the app's navigation.
//
// The header and the mobile bottom bar read from this single 5-pillar list.
// Order: Household -> Family -> Inventory -> Reports -> Notifications.
import { Home, Users, Package, ChartLine, Bell } from 'lucide-svelte';

export interface NavItem {
	id: string;
	label: string;
	href: string;
	matchPrefixes: string[];
	icon: typeof Home;
}

/**
 * Destinations reachable from both the header and the mobile bottom bar.
 * Order: Household -> Family -> Inventory -> Reports -> Notifications.
 */
export const PRIMARY_NAV: NavItem[] = [
	{
		id: 'home',
		label: 'Household',
		href: '/home',
		matchPrefixes: ['/home', '/assets'],
		icon: Home,
	},
	{
		id: 'family',
		label: 'Family',
		href: '/family',
		matchPrefixes: ['/family', '/appointments', '/dashboard'],
		icon: Users,
	},
	{
		id: 'inventory',
		label: 'Inventory',
		href: '/inventory',
		matchPrefixes: ['/inventory'],
		icon: Package,
	},
	{
		id: 'reports',
		label: 'Reports',
		href: '/reports',
		matchPrefixes: ['/reports'],
		icon: ChartLine,
	},
	{
		id: 'notifications',
		label: 'Notifications',
		href: '/notifications',
		matchPrefixes: ['/notifications'],
		icon: Bell,
	},
];

export const BOTTOM_NAV: NavItem[] = PRIMARY_NAV;

export function isNavItemActive(item: NavItem, pathname: string): boolean {
	if (!pathname) return false;
	return item.matchPrefixes.some((prefix) => pathname.startsWith(prefix));
}
