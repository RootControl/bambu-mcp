// airpods-max-desk-hook: desk-edge hanger for AirPods Max (384.8 g)
//
// Hooks over a 35mm desktop. Two contoured rails carry the metal headband arms
// so the knit mesh canopy never takes any load - mesh sag is the known failure
// mode on these.
//
// Print it as modelled, lying on its side: the whole C-profile is a vertical
// extrusion, so nothing overhangs and no supports are needed. What reads as
// "up" in use is +Y here; Z is the width along the desk edge.

/* ---- desk ---- */
desk_t       = 35;    // measured desktop thickness
desk_clear   = 1.5;   // slip fit over the edge
top_arm      = 70;    // reach back across the desk top
bot_arm      = 50;    // reach back underneath

/* ---- structure ---- */
arm_t        = 10;    // arm thickness
web_t        = 10;    // web thickness at the desk edge
hook_w       = 50;    // width along the desk edge (= print height)
gusset       = 12;    // 45 deg fillet at the cradle root

/* ---- saddle ---- */
// The hook passes UNDER the headband, so it meets the arch's inner surface:
// the saddle has to be convex for the arch to nest over it. A concave trough
// would touch at a single point and dig in.
cradle_out   = 60;    // saddle centre, measured out from the desk face
cradle_w     = 52;    // total width across both rails
saddle_r     = 80;    // convex radius, matched to the headband arch
saddle_top   = 32;    // height of the saddle crown
block_h      = 34;    // blank the saddle is carved from
relief_w     = 30;    // mesh clearance channel between the rails
relief_d     = 10;    // the knit canopy sags below the metal frame - clear it

eps = 0.01;

slot_h    = desk_t + desk_clear;
top_y0    = arm_t + slot_h;        // underside of the top arm
top_y1    = top_y0 + arm_t;
cradle_x0 = cradle_out - cradle_w / 2;
cradle_x1 = cradle_out + cradle_w / 2;
cz        = hook_w / 2;            // cradle centred across the width

// C-hook and cradle arm, traced as one closed outline.
profile = [
    [-bot_arm,        0],
    [cradle_x1,       0],
    [cradle_x1,       arm_t],
    [web_t + gusset,  arm_t],      // 45 deg gusset into the web
    [web_t,           arm_t + gusset],
    [web_t,           top_y1],
    [-top_arm,        top_y1],
    [-top_arm,        top_y0],
    [0,               top_y0],     // underside of the top arm
    [0,               arm_t],      // back of the desk slot
    [-bot_arm,        arm_t],
];

// A cylinder laid along X: its circular section sits in the YZ plane, which is
// exactly the plane the headband arch curves in.
module arch_cutter(r, cy, x0, len) {
    translate([x0, cy, cz])
        rotate([0, 90, 0])
            cylinder(h = len, r = r, $fn = 200);
}

module saddle_blank() {
    translate([cradle_x0, arm_t, 0])
        cube([cradle_w, block_h - arm_t, hook_w]);
}

module hook() {
    union() {
        linear_extrude(height = hook_w) polygon(profile);

        difference() {
            // Crown the blank into a convex saddle the arch can nest over.
            intersection() {
                saddle_blank();
                arch_cutter(saddle_r, saddle_top - saddle_r,
                            cradle_x0 - eps, cradle_w + 2 * eps);
            }

            // Mesh relief: everything above the same curve dropped by relief_d,
            // limited to the centre band. Leaves two rails carrying the metal
            // frame with the canopy hanging clear between them.
            difference() {
                translate([cradle_out - relief_w / 2, -eps, -eps])
                    cube([relief_w, block_h + 20, hook_w + 2 * eps]);
                arch_cutter(saddle_r, saddle_top - saddle_r - relief_d,
                            cradle_x0 - 2 * eps, cradle_w + 4 * eps);
            }
        }
    }
}

hook();
