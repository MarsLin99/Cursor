import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment, OrbitControls } from '@react-three/drei'
import { Suspense, useMemo } from 'react'

/**
 * 簡化日式兩層建築量體（含太陽屋瓦屋頂與側邊車位）
 */
function HouseModel() {
  const solarTiles = useMemo(() => {
    const tiles: Array<[number, number, number]> = []
    for (let i = -4; i <= 4; i += 1) {
      for (let j = 0; j < 5; j += 1) {
        tiles.push([i * 0.55, 0.02, -1.8 + j * 0.55])
      }
    }
    return tiles
  }, [])

  return (
    <group position={[0.6, 0, 0]}>
      {/* 基地地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.4, 0, 0]} receiveShadow>
        <planeGeometry args={[10.2, 11.2]} />
        <meshStandardMaterial color="#d8d2c6" />
      </mesh>

      {/* 後院 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.2, 0.01, -4.6]} receiveShadow>
        <planeGeometry args={[6.2, 1.2]} />
        <meshStandardMaterial color="#6b7f56" />
      </mesh>

      {/* 固定車位 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.3, 0.015, 2.6]} receiveShadow>
        <planeGeometry args={[2.6, 5.2]} />
        <meshStandardMaterial color="#b8c0c7" />
      </mesh>
      {/* 靈活空間 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.3, 0.015, -2.4]} receiveShadow>
        <planeGeometry args={[2.6, 4.6]} />
        <meshStandardMaterial color="#c5c0b2" />
      </mesh>

      {/* 一樓量體 */}
      <mesh position={[1.0, 1.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[6.5, 2.9, 9.5]} />
        <meshStandardMaterial color="#f2eee6" roughness={0.85} />
      </mesh>

      {/* 杉木立面飾板 */}
      <mesh position={[-2.26, 1.45, 2.2]} castShadow>
        <boxGeometry args={[0.08, 2.6, 3.8]} />
        <meshStandardMaterial color="#8b6914" roughness={0.7} />
      </mesh>

      {/* 二樓量體略退縮感由屋頂表現 */}
      <mesh position={[1.0, 3.9, 0]} castShadow>
        <boxGeometry args={[6.5, 2.0, 9.5]} />
        <meshStandardMaterial color="#efeae1" roughness={0.85} />
      </mesh>

      {/* 開口窗 */}
      {[
        [ -2.28, 1.5, 0.5],
        [ -2.28, 3.7, 0.5],
        [ 1.0, 1.5, 4.78],
        [ 2.5, 3.7, 4.78],
      ].map((pos, idx) => (
        <mesh key={idx} position={pos as [number, number, number]}>
          <boxGeometry args={idx < 2 ? [0.06, 1.4, 1.6] : [1.8, 1.4, 0.06]} />
          <meshStandardMaterial color="#9ca8a0" metalness={0.1} roughness={0.3} />
        </mesh>
      ))}

      {/* 切妻屋根 */}
      <group position={[1.0, 5.15, 0]}>
        <mesh rotation={[0.42, 0, 0]} position={[0, 0.35, -2.1]} castShadow>
          <boxGeometry args={[7.0, 0.12, 5.4]} />
          <meshStandardMaterial color="#2a2622" roughness={0.55} metalness={0.25} />
        </mesh>
        <mesh rotation={[-0.42, 0, 0]} position={[0, 0.35, 2.1]} castShadow>
          <boxGeometry args={[7.0, 0.12, 5.4]} />
          <meshStandardMaterial color="#2a2622" roughness={0.55} metalness={0.25} />
        </mesh>

        {/* 太陽屋瓦格子 */}
        {solarTiles.map(([x, , z], i) => (
          <mesh
            key={`s1-${i}`}
            position={[x, 0.55 + Math.abs(z) * 0.08, z - 0.3]}
            rotation={[0.42, 0, 0]}
          >
            <boxGeometry args={[0.48, 0.03, 0.48]} />
            <meshStandardMaterial color="#1a1816" metalness={0.45} roughness={0.35} />
          </mesh>
        ))}
      </group>

      {/* 簡易車輛示意 */}
      <mesh position={[-3.3, 0.55, 3.2]} castShadow>
        <boxGeometry args={[1.8, 1.1, 4.2]} />
        <meshStandardMaterial color="#5f6b66" roughness={0.4} metalness={0.2} />
      </mesh>
    </group>
  )
}

/**
 * 可旋轉的建築 3D 示意場景
 */
export function HouseScene() {
  return (
    <div className="h-[420px] w-full overflow-hidden rounded-sm bg-[#d4dde3] md:h-[520px]">
      <Canvas camera={{ position: [11, 8, 12], fov: 38 }} shadows>
        <color attach="background" args={['#d4dde3']} />
        <ambientLight intensity={0.55} />
        <directionalLight
          castShadow
          intensity={1.15}
          position={[8, 14, 6]}
          shadow-mapSize={[1024, 1024]}
        />
        <Suspense fallback={null}>
          <HouseModel />
          <Environment preset="city" />
          <ContactShadows position={[0, 0.01, 0]} opacity={0.35} scale={20} blur={2.2} />
        </Suspense>
        <OrbitControls
          enablePan={false}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI / 2.1}
          minDistance={8}
          maxDistance={22}
          target={[0, 1.5, 0]}
        />
      </Canvas>
    </div>
  )
}
