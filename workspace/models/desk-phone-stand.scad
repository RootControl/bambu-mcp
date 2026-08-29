// desk-phone-stand: leaning desk stand for a phone, prints with no supports
// Bambu Lab A1 mini (180x180x180mm)

width        = 80;   // Y: stand width - wide enough to hold a phone in landscape too
base_depth   = 78;   // X: front-to-back footprint
base_t       = 5;    // base slab thickness
lip_x        = 8;    // front lip, distance back from the front edge
lip_t        = 5;    // lip thickness
lip_top      = 20;   // absolute Z of the lip top
cradle_gap   = 16;   // clearance for the phone plus a chunky case
wall_tx      = 7;    // horizontal thickness of the leaning wall
wall_top     = 78;   // absolute Z of the wall top
lean         = 22;   // degrees the wall leans back from vertical
buttress_x   = 55;   // where the rear buttress leaves the base
buttress_z   = 30;   // height where the rear buttress meets the wall
cable_w      = 24;   // width of the charging cable channel
eps          = 0.01;

t             = tan(lean);
wall_front_x0 = lip_x + lip_t + cradle_gap;   // wall front face at base level

// The wall leans, so its faces shift back as they rise.
function wfx(z) = wall_front_x0 + (z - base_t) * t;
function wbx(z) = wfx(z) + wall_tx;

// Silhouette traced in XZ. Every segment either rises inward or leans back by
// less than 45 degrees, so nothing needs support.
profile = [
    [0,                  0],
    [base_depth,         0],
    [base_depth,         base_t],
    [buttress_x,         base_t],     // flat rear deck, then the buttress rises
    [wbx(buttress_z),    buttress_z],
    [wbx(wall_top),      wall_top],
    [wfx(wall_top),      wall_top],
    [wfx(base_t),        base_t],     // wall front face, where the phone rests
    [lip_x + lip_t,      base_t],     // cradle floor
    [lip_x + lip_t,      lip_top],    // lip
    [lip_x,              lip_top],
    [lip_x,              base_t],
    [0,                  base_t],
];

module stand() {
    difference() {
        translate([0, width, 0])
            rotate([90, 0, 0])
                linear_extrude(height = width)
                    polygon(profile);

        // Cable channel: severs the lip and the base ahead of the wall so a
        // charging cable can run in from the front or drop through the desk.
        translate([-eps, (width - cable_w) / 2, -eps])
            cube([wall_front_x0 + eps, cable_w, lip_top + eps]);
    }
}

stand();
