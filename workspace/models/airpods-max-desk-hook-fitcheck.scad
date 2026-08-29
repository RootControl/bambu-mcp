// Fit check - NOT for printing. The hook rotated into its in-use orientation
// on a 35mm desk, with a simplified AirPods Max ghosted in to check clearances.
// Real figures: 187.3 x 168.6 x 83.4mm, 384.8 g.

use <airpods-max-desk-hook.scad>

desk_t     = 35;
top_y0     = 46.5;    // underside of the top arm
saddle_top = 32;      // saddle crown
cz         = 25;      // saddle centre across the width
cradle_out = 60;

hp_w       = 168.6;   // ear to ear
arch_ri    = 78;      // headband inner radius - what rests on the saddle
arch_ro    = 90;      // outer radius of the band
cup_d      = 90;
cup_t      = 40;

// Rotate the printed part upright: model +Y becomes world +Z (up).
rotate([90, 0, 0]) hook();

// Desk. Its top face meets the underside of the top arm.
%translate([-150, -130, top_y0 - desk_t]) cube([150, 200, desk_t]);

// Headband arch. Its centre of curvature sits BELOW the band, so the inner
// apex comes down onto the saddle crown - this is the contact the saddle
// was shaped for.
%translate([cradle_out - cup_t / 2, -cz, saddle_top - arch_ri])
    rotate([0, 90, 0])
        linear_extrude(cup_t)
            difference() {
                circle(r = arch_ro, $fn = 160);
                circle(r = arch_ri, $fn = 160);
                translate([0, -arch_ro]) square([arch_ro * 2, arch_ro * 2]);
            }

// Earcups hanging at each end.
for (side = [-1, 1])
    %translate([cradle_out, -cz + side * hp_w / 2 * 0.89, -98])
        rotate([90, 0, 0])
            cylinder(h = cup_t, d = cup_d, center = true, $fn = 64);
