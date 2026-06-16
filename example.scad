// ── Parâmetros principais ──────────────────────────────────
width  = 30;       // [5:200]   Largura da peça (mm)
height = 20;       // [2:150]   Altura da peça (mm)
depth  = 15;       // [2:150]   Profundidade (mm)

wall_thickness = 2;   // [0.5:1:10]  Espessura da parede
corner_radius  = 3;   // [0:10]      Raio do canto

// ── Furo central ──────────────────────────────────────────
has_hole    = true;
hole_radius = 5;   // [1:30]

// ── Cor e aparência ───────────────────────────────────────
color_name = "SteelBlue";
opacity    = 0.9;  // [0:0.05:1]

// ── Grade de resolução ────────────────────────────────────
$fn = 64;   // [8:4:128]

// ── Posicionamento ────────────────────────────────────────
offset = [0, 0, 0];
scale_factor = 1.0;  // [0.1:0.1:5]

// ============================================================
module rounded_box(w, h, d, r) {
    minkowski() {
        cube([w - 2*r, h - 2*r, d - 2*r], center=true);
        sphere(r);
    }
}

color(color_name, opacity)
translate(offset)
scale([scale_factor, scale_factor, scale_factor]) {
    difference() {
        rounded_box(width, height, depth, corner_radius);

        if (has_hole) {
            cylinder(h = depth + 1, r = hole_radius, center = true);
        }

        // Escava o interior
        rounded_box(
            width  - wall_thickness * 2,
            height - wall_thickness * 2,
            depth  - wall_thickness,
            max(0.5, corner_radius - wall_thickness)
        );
    }
}
