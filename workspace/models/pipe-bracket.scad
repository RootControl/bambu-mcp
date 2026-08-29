
// pipe-bracket: wall bracket for a 22mm pipe with two M4 screw holes
pipe_d      = 22;
wall        = 4;
overlap     = 3;   // collar sinks into the back plate so the union is solid
depth       = 18;
plate_w     = 60;
plate_t     = 5;
screw_d     = 4.4;
screw_pitch = 44;
eps         = 0.01;

module bracket() {
    difference() {
        union() {
            // back plate
            translate([-plate_w/2, -plate_t, 0]) cube([plate_w, plate_t, depth]);
            // collar
            translate([0, pipe_d/2 + wall - overlap, 0])
                cylinder(h = depth, d = pipe_d + 2*wall, $fn = 96);
        }
        // pipe bore, opened top and bottom so no coincident faces remain
        translate([0, pipe_d/2 + wall - overlap, -eps])
            cylinder(h = depth + 2*eps, d = pipe_d, $fn = 96);
        // screw holes through the back plate
        for (x = [-screw_pitch/2, screw_pitch/2])
            translate([x, -plate_t - eps, depth/2])
                rotate([-90, 0, 0])
                    cylinder(h = plate_t + 2*eps, d = screw_d, $fn = 48);
    }
}
bracket();
