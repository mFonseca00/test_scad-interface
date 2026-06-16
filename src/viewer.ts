import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class ScadViewer {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private modelGroup: THREE.Group | null = null;
  private animId = 0;
  private wireframe = false;

  constructor(private container: HTMLElement) {
    const canvas = document.createElement('canvas');
    container.appendChild(canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.setClearColor(0x0d1117);

    this.scene = new THREE.Scene();

    // Câmera
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
    this.camera.position.set(60, 50, 80);

    // Luzes
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 10, 7);
    dirLight.castShadow = true;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
    fillLight.position.set(-5, -3, -5);
    this.scene.add(fillLight);

    // Grid e eixos
    const grid = new THREE.GridHelper(200, 20, 0x1e2235, 0x1e2235);
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(15);
    this.scene.add(axes);

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.1;
    this.controls.maxDistance = 5000;

    // Resize
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(container);
    this.resize();

    this.animate();
  }

  private animate = () => {
    this.animId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setGeometry(group: THREE.Group) {
    if (this.modelGroup) {
      this.scene.remove(this.modelGroup);
      this.disposeGroup(this.modelGroup);
    }
    this.modelGroup = group;

    // Converte SCAD (Z-up) para Three.js (Y-up) rodando o grupo raiz
    group.rotation.x = -Math.PI / 2;

    this.applyWireframe(group, this.wireframe);
    this.scene.add(group);
    this.fitCamera(group);
  }

  private fitCamera(obj: THREE.Object3D) {
    obj.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = this.camera.fov * (Math.PI / 180);
    const dist = (maxDim / 2) / Math.tan(fov / 2) * 2.2;

    this.camera.position.set(
      center.x + dist * 0.6,
      center.y + dist * 0.5,
      center.z + dist * 0.8
    );
    this.camera.lookAt(center);
    this.controls.target.copy(center);
    this.controls.update();
  }

  resetCamera() {
    if (this.modelGroup) {
      this.fitCamera(this.modelGroup);
    }
  }

  toggleWireframe(): boolean {
    this.wireframe = !this.wireframe;
    if (this.modelGroup) this.applyWireframe(this.modelGroup, this.wireframe);
    return this.wireframe;
  }

  private applyWireframe(obj: THREE.Object3D, wf: boolean) {
    obj.traverse(child => {
      if (child instanceof THREE.Mesh && child.material) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.wireframe = wf;
      }
    });
  }

  private disposeGroup(group: THREE.Group) {
    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          (child.material as THREE.Material)?.dispose();
        }
      }
    });
  }

  dispose() {
    cancelAnimationFrame(this.animId);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
