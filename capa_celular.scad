// ========================================
// CAPA DE CELULAR PARAMETRIZADA - OpenSCAD
// ========================================

/* [Dimensões do Celular] */
// Largura do celular (mm)
largura_celular = 75;
// Altura do celular (mm)
altura_celular = 150;
// Espessura do celular (mm)
espessura_celular = 8;

/* [Dimensões da Capa] */
// Espessura da parede da capa (mm)
espessura_parede = 2;
// Folga interna para encaixe (mm)
folga = 0.3;
// Altura da borda frontal elevada (proteção de tela) (mm)
altura_borda_frontal = 0.8;
// Raio de arredondamento das bordas (mm)
raio_arredondamento = 3;

/* [Recortes - Câmera] */
// Posição X da câmera (do canto esquerdo) (mm)
camera_x = 12;
// Posição Y da câmera (do topo) (mm)
camera_y = 12;
// Largura do recorte da câmera (mm)
camera_largura = 30;
// Altura do recorte da câmera (mm)
camera_altura = 30;
// Profundidade do recorte da câmera (mm)
camera_profundidade = 2;

/* [Recortes - Botões Laterais] */
// Posição Y do botão de volume (do topo) (mm)
botao_volume_y = 60;
// Altura do recorte do botão de volume (mm)
botao_volume_altura = 25;
// Posição Y do botão de power (do topo) (mm)
botao_power_y = 70;
// Altura do recorte do botão de power (mm)
botao_power_altura = 15;

/* [Recortes - Base] */
// Largura do recorte USB (mm)
usb_largura = 12;
// Altura do recorte USB (mm)
usb_altura = 8;
// Largura do recorte do alto-falante (mm)
speaker_largura = 15;
// Distância entre recortes na base (mm)
distancia_recortes_base = 20;

/* [Qualidade de Renderização] */
// Resolução de círculos ($fn)
resolucao = 50;

// ========================================
// MÓDULOS
// ========================================

module corpo_externo() {
    hull() {
        for(x = [raio_arredondamento, largura_celular + 2*espessura_parede + 2*folga - raio_arredondamento]) {
            for(y = [raio_arredondamento, altura_celular + 2*espessura_parede + 2*folga - raio_arredondamento]) {
                translate([x, y, raio_arredondamento])
                    sphere(r=raio_arredondamento, $fn=resolucao);
                translate([x, y, espessura_celular + espessura_parede + folga - raio_arredondamento])
                    sphere(r=raio_arredondamento, $fn=resolucao);
            }
        }
    }
}

module cavidade_interna() {
    translate([espessura_parede + folga, espessura_parede + folga, espessura_parede]) {
        hull() {
            for(x = [raio_arredondamento/2, largura_celular - raio_arredondamento/2]) {
                for(y = [raio_arredondamento/2, altura_celular - raio_arredondamento/2]) {
                    translate([x, y, raio_arredondamento/2])
                        sphere(r=raio_arredondamento/2, $fn=resolucao);
                    translate([x, y, espessura_celular + altura_borda_frontal])
                        sphere(r=raio_arredondamento/2, $fn=resolucao);
                }
            }
        }
    }
}

module recorte_camera() {
    translate([espessura_parede + folga + camera_x - camera_profundidade/2,
               altura_celular + 2*espessura_parede + 2*folga - camera_y - camera_altura,
               espessura_celular + espessura_parede + folga - camera_profundidade]) {
        hull() {
            for(x = [raio_arredondamento/2, camera_largura - raio_arredondamento/2]) {
                for(y = [raio_arredondamento/2, camera_altura - raio_arredondamento/2]) {
                    translate([x, y, 0])
                        cylinder(r=raio_arredondamento/2, h=camera_profundidade*2, $fn=resolucao);
                }
            }
        }
    }
}

module recorte_botoes_esquerda() {
    // Botão de volume
    translate([-1, espessura_parede + folga + botao_volume_y, espessura_parede + espessura_celular/2 - botao_volume_altura/2]) {
        cube([espessura_parede + 2, botao_volume_altura, botao_volume_altura]);
    }
}

module recorte_botoes_direita() {
    // Botão de power
    translate([largura_celular + 2*espessura_parede + 2*folga - espessura_parede - 1,
               espessura_parede + folga + botao_power_y,
               espessura_parede + espessura_celular/2 - botao_power_altura/2]) {
        cube([espessura_parede + 2, botao_power_altura, botao_power_altura]);
    }
}

module recorte_usb() {
    translate([largura_celular/2 + espessura_parede + folga - usb_largura/2,
               -1,
               espessura_parede/2 - usb_altura/2 + espessura_parede/2]) {
        cube([usb_largura, espessura_parede + 2, usb_altura]);
    }
}

module recorte_speaker_esquerdo() {
    translate([largura_celular/2 + espessura_parede + folga - speaker_largura - distancia_recortes_base/2,
               -1,
               espessura_parede/2]) {
        hull() {
            translate([2, 0, 0])
                cylinder(r=2, h=espessura_parede + 2, $fn=resolucao);
            translate([speaker_largura - 2, 0, 0])
                cylinder(r=2, h=espessura_parede + 2, $fn=resolucao);
        }
    }
}

module recorte_speaker_direito() {
    translate([largura_celular/2 + espessura_parede + folga + distancia_recortes_base/2,
               -1,
               espessura_parede/2]) {
        hull() {
            translate([2, 0, 0])
                cylinder(r=2, h=espessura_parede + 2, $fn=resolucao);
            translate([speaker_largura - 2, 0, 0])
                cylinder(r=2, h=espessura_parede + 2, $fn=resolucao);
        }
    }
}

// ========================================
// MONTAGEM FINAL
// ========================================

difference() {
    // Corpo principal
    corpo_externo();

    // Remove cavidade interna
    cavidade_interna();

    // Recortes
    recorte_camera();
    recorte_botoes_esquerda();
    recorte_botoes_direita();
    recorte_usb();
    recorte_speaker_esquerdo();
    recorte_speaker_direito();
}
