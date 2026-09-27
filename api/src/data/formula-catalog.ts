export type FormulaCatalogItem = {
	name: string;
	brand: string;
	formulaType: string;
};

export const DEFAULT_FORMULA_CATALOG: FormulaCatalogItem[] = [
	// ── Enfamil (Mead Johnson) ──────────────────────────────────────────
	{ brand: 'Enfamil', name: 'NeuroPro Infant', formulaType: 'standard' },
	{ brand: 'Enfamil', name: 'NeuroPro Gentlease', formulaType: 'gentle' },
	{ brand: 'Enfamil', name: 'NeuroPro EnfaCare', formulaType: 'premature' },
	{ brand: 'Enfamil', name: 'Gentlease', formulaType: 'gentle' },
	{ brand: 'Enfamil', name: 'A.R.', formulaType: 'anti-reflux' },
	{ brand: 'Enfamil', name: 'Reguline', formulaType: 'gentle' },
	{ brand: 'Enfamil', name: 'Nutramigen', formulaType: 'hypoallergenic' },
	{ brand: 'Enfamil', name: 'PurAmino', formulaType: 'hydrolyzed' },
	{ brand: 'Enfamil', name: 'ProSobee Simply Plant-Based', formulaType: 'soy' },
	{ brand: 'Enfamil', name: 'Enspire Optimum', formulaType: 'standard' },
	{ brand: 'Enfamil', name: 'Enspire Optimum Gentlease', formulaType: 'gentle' },
	{ brand: 'Enfamil', name: 'Infant', formulaType: 'standard' },
	{ brand: 'Enfamil', name: 'NeuroPro Care', formulaType: 'standard' },
	{ brand: 'Enfamil', name: 'Premature 24 Cal', formulaType: 'premature' },
	{ brand: 'Enfamil', name: 'Premature 30 Cal', formulaType: 'premature' },
	{ brand: 'Enfamil', name: 'A2', formulaType: 'standard' },
	{ brand: 'Enfamil', name: 'Simply Organic', formulaType: 'standard' },
	{ brand: 'Enfamil', name: 'Pregestimil', formulaType: 'hypoallergenic' },

	// ── Similac (Abbott) ─────────────────────────────────────────────────
	{ brand: 'Similac', name: '360 Total Care', formulaType: 'standard' },
	{ brand: 'Similac', name: '360 Total Care Sensitive', formulaType: 'sensitive' },
	{ brand: 'Similac', name: '360 Total Care Gentle Comfort', formulaType: 'gentle' },
	{ brand: 'Similac', name: 'Advance', formulaType: 'standard' },
	{ brand: 'Similac', name: 'Sensitive', formulaType: 'sensitive' },
	{ brand: 'Similac', name: 'Total Comfort', formulaType: 'gentle' },
	{ brand: 'Similac', name: 'Alimentum', formulaType: 'hypoallergenic' },
	{ brand: 'Similac', name: 'NeoSure', formulaType: 'premature' },
	{ brand: 'Similac', name: 'Soy Isomil', formulaType: 'soy' },
	{ brand: 'Similac', name: 'for Spit-Up', formulaType: 'anti-reflux' },
	{ brand: 'Similac', name: 'Organic', formulaType: 'standard' },
	{ brand: 'Similac', name: 'Organic with A2 Milk', formulaType: 'standard' },
	{ brand: 'Similac', name: 'Pure Bliss by Similac', formulaType: 'standard' },
	{ brand: 'Similac', name: 'EleCare', formulaType: 'hydrolyzed' },
	{ brand: 'Similac', name: 'PM 60/40', formulaType: 'sensitive' },
	{ brand: 'Similac', name: 'Special Care 24', formulaType: 'premature' },
	{ brand: 'Similac', name: 'Special Care 30', formulaType: 'premature' },
	{ brand: 'Similac', name: 'Pro-Advance', formulaType: 'standard' },
	{ brand: 'Similac', name: 'Pro-Sensitive', formulaType: 'sensitive' },
	{ brand: 'Similac', name: 'Pro-Total Comfort', formulaType: 'gentle' },

	// ── Gerber Good Start (Nestlé) ──────────────────────────────────────
	{ brand: 'Gerber Good Start', name: 'GentlePro', formulaType: 'gentle' },
	{ brand: 'Gerber Good Start', name: 'SoothePro', formulaType: 'gentle' },
	{ brand: 'Gerber Good Start', name: 'Extensive HA', formulaType: 'hypoallergenic' },
	{ brand: 'Gerber Good Start', name: 'Soy', formulaType: 'soy' },
	{ brand: 'Gerber Good Start', name: 'A2', formulaType: 'standard' },
	{ brand: 'Gerber Good Start', name: 'DHA & ARA', formulaType: 'standard' },

	// ── Kendamil (UK) ────────────────────────────────────────────────────
	{ brand: 'Kendamil', name: 'Classic First Infant Milk', formulaType: 'standard' },
	{ brand: 'Kendamil', name: 'Organic First Infant Milk', formulaType: 'standard' },
	{ brand: 'Kendamil', name: 'Goat First Infant Milk', formulaType: 'goat-milk' },
	{ brand: 'Kendamil', name: 'Comfort Milk', formulaType: 'gentle' },

	// ── Bobbie ───────────────────────────────────────────────────────────
	{ brand: 'Bobbie', name: 'Organic Infant Formula', formulaType: 'standard' },
	{ brand: 'Bobbie', name: 'Organic Gentle', formulaType: 'gentle' },
	{ brand: 'Bobbie', name: 'Organic Whole Milk', formulaType: 'standard' },

	// ── ByHeart ──────────────────────────────────────────────────────────
	{ brand: 'ByHeart', name: 'Whole Nutrition Infant Formula', formulaType: 'standard' },

	// ── Aptamil (Danone) ─────────────────────────────────────────────────
	{ brand: 'Aptamil', name: 'First Infant Milk', formulaType: 'standard' },
	{ brand: 'Aptamil', name: 'Anti-Reflux', formulaType: 'anti-reflux' },
	{ brand: 'Aptamil', name: 'Lactose Free', formulaType: 'lactose-free' },
	{ brand: 'Aptamil', name: 'Pepti', formulaType: 'hydrolyzed' },
	{ brand: 'Aptamil', name: 'Comfort', formulaType: 'gentle' },
	{ brand: 'Aptamil', name: 'Gold Plus', formulaType: 'standard' },

	// ── Hipp (EU Organic) ────────────────────────────────────────────────
	{ brand: 'Hipp', name: 'Combiotic Stage 1', formulaType: 'standard' },
	{ brand: 'Hipp', name: 'HA Combiotic', formulaType: 'hypoallergenic' },
	{ brand: 'Hipp', name: 'AR', formulaType: 'anti-reflux' },
	{ brand: 'Hipp', name: 'Comfort', formulaType: 'gentle' },
	{ brand: 'Hipp', name: 'Dutch Stage 1', formulaType: 'standard' },
	{ brand: 'Hipp', name: 'German Stage 1', formulaType: 'standard' },

	// ── Holle (EU Organic / Demeter) ─────────────────────────────────────
	{ brand: 'Holle', name: 'Bio Stage 1', formulaType: 'standard' },
	{ brand: 'Holle', name: 'Bio Goat Stage 1', formulaType: 'goat-milk' },
	{ brand: 'Holle', name: 'A2 Stage 1', formulaType: 'standard' },

	// ── NAN / Nestlé ─────────────────────────────────────────────────────
	{ brand: 'Nestlé NAN', name: 'Optipro 1', formulaType: 'standard' },
	{ brand: 'Nestlé NAN', name: 'SupremePro 1', formulaType: 'standard' },
	{ brand: 'Nestlé NAN', name: 'ExpertPro HA', formulaType: 'hypoallergenic' },
	{ brand: 'Nestlé NAN', name: 'ExpertPro Sensipro', formulaType: 'gentle' },
	{ brand: 'Nestlé NAN', name: 'Pro 1', formulaType: 'standard' },

	// ── SMA (Nestlé UK) ──────────────────────────────────────────────────
	{ brand: 'SMA', name: 'First Infant Milk', formulaType: 'standard' },
	{ brand: 'SMA', name: 'Pro Anti-Reflux', formulaType: 'anti-reflux' },
	{ brand: 'SMA', name: 'Althéra', formulaType: 'hydrolyzed' },
	{ brand: 'SMA', name: 'Lactose Free', formulaType: 'lactose-free' },

	// ── Nutricia ─────────────────────────────────────────────────────────
	{ brand: 'Nutricia', name: 'Neocate Infant DHA/ARA', formulaType: 'hydrolyzed' },
	{ brand: 'Nutricia', name: 'Neocate Syneo', formulaType: 'hydrolyzed' },
	{ brand: 'Nutricia', name: 'Pepticate', formulaType: 'hypoallergenic' },
	{ brand: 'Nutricia', name: 'Fortini', formulaType: 'premature' },

	// ── Bubs (Australia) ─────────────────────────────────────────────────
	{ brand: 'Bubs', name: '365 Day Grass Fed', formulaType: 'standard' },
	{ brand: 'Bubs', name: 'Essential Infant', formulaType: 'standard' },
	{ brand: 'Bubs', name: 'Goat Milk Infant', formulaType: 'goat-milk' },
	{ brand: 'Bubs', name: 'Supreme A2', formulaType: 'standard' },
	{ brand: 'Bubs', name: 'Organic Grass Fed', formulaType: 'standard' },

	// ── Kabrita ──────────────────────────────────────────────────────────
	{ brand: 'Kabrita', name: 'Goat Milk Infant Formula', formulaType: 'goat-milk' },

	// ── Earth's Best ─────────────────────────────────────────────────────
	{ brand: "Earth's Best", name: 'Organic Dairy Infant Formula', formulaType: 'standard' },
	{ brand: "Earth's Best", name: 'Organic Gentle', formulaType: 'gentle' },
	{ brand: "Earth's Best", name: 'Organic Sensitivity', formulaType: 'sensitive' },
	{ brand: "Earth's Best", name: 'Non-GMO Plant Based', formulaType: 'soy' },

	// ── Happy Baby ───────────────────────────────────────────────────────
	{ brand: 'Happy Baby', name: 'Organic Infant Formula Stage 1', formulaType: 'standard' },
	{ brand: 'Happy Baby', name: 'Organic Infant A2 Stage 1', formulaType: 'standard' },
	{ brand: 'Happy Baby', name: 'Organic Infant Formula Stage 2', formulaType: 'standard' },

	// ── Store Brand / Private Label (Perrigo) ────────────────────────────
	{ brand: 'Store Brand', name: 'Advantage Premium', formulaType: 'standard' },
	{ brand: 'Store Brand', name: 'Gentle Premium', formulaType: 'gentle' },
	{ brand: 'Store Brand', name: 'Sensitivity Premium', formulaType: 'sensitive' },
	{ brand: 'Store Brand', name: 'Infant Premium', formulaType: 'standard' },
	{ brand: 'Store Brand', name: 'Soy', formulaType: 'soy' },
	{ brand: 'Store Brand', name: 'Hypoallergenic', formulaType: 'hypoallergenic' },
	{ brand: 'Store Brand', name: 'Complete Comfort', formulaType: 'gentle' },
	{ brand: 'Store Brand', name: 'Added Rice', formulaType: 'anti-reflux' },

	// ── Parent's Choice (Walmart) ────────────────────────────────────────
	{ brand: "Parent's Choice", name: 'Advantage Infant', formulaType: 'standard' },
	{ brand: "Parent's Choice", name: 'Gentle', formulaType: 'gentle' },
	{ brand: "Parent's Choice", name: 'Sensitivity', formulaType: 'sensitive' },
	{ brand: "Parent's Choice", name: 'Soy', formulaType: 'soy' },
	{ brand: "Parent's Choice", name: 'Hypoallergenic', formulaType: 'hypoallergenic' },

	// ── Kirkland (Costco) ────────────────────────────────────────────────
	{ brand: 'Kirkland Signature', name: 'ProCare', formulaType: 'standard' },

	// ── Up & Up (Target) ─────────────────────────────────────────────────
	{ brand: 'Up & Up', name: 'Infant Formula', formulaType: 'standard' },
	{ brand: 'Up & Up', name: 'Gentle Premium', formulaType: 'gentle' },
	{ brand: 'Up & Up', name: 'Sensitivity Premium', formulaType: 'sensitive' },

	// ── Mama Bear (Amazon) ───────────────────────────────────────────────
	{ brand: 'Mama Bear', name: 'Gentle Infant Formula', formulaType: 'gentle' },
	{ brand: 'Mama Bear', name: 'Sensitive Infant Formula', formulaType: 'sensitive' },

	// ── Other ────────────────────────────────────────────────────────────
	{ brand: "Baby's Only", name: 'Organic', formulaType: 'standard' },
	{ brand: "Baby's Only", name: 'Gentle', formulaType: 'gentle' },
	{ brand: "Burt's Bees Baby", name: 'Ultra Gentle', formulaType: 'gentle' },
	{ brand: 'Munchkin', name: 'Grass Fed Milk-Based Powder', formulaType: 'standard' },
	{ brand: 'Munchkin', name: 'Organic Milk-Based Powder', formulaType: 'standard' },
	{ brand: 'J&J Sunrise', name: 'Milk-Based Infant Formula', formulaType: 'standard' },
	{ brand: 'Alfamino', name: 'Infant', formulaType: 'hydrolyzed' },
	{ brand: 'Nannycare', name: 'Goat Milk Formula', formulaType: 'goat-milk' },
	{ brand: 'Bellamy', name: 'Organic', formulaType: 'standard' },
];