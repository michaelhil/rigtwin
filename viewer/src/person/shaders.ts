// The person's shader changes, each scoped to the person's own materials (per-material onBeforeCompile; THREE.ShaderChunk
// and THREE.ShaderLib are read, never written, so the rig's materials compile exactly as before):
//
//   skinning   dual-quaternion skinning mixed per vertex by the `_DQS` mask, eight influences per vertex (lab dqs.ts)
//   contact    the seat pan solid, the backrest plane, capsules and the displaced-tissue roll, applied after skinning in
//              the same chunk, so the colour pass and the shadow depth pass move the same vertices (lab contact.ts)
//   shadows    the contact-hardening soft-shadow filter and a small normal offset for the key light's shadow on the person
//              (lab studio.ts installSoftShadows); the light's size and the map's frustum come in as uniforms, not through the
//              light's own bias and radius as in the lab, so the rig's key light keeps its settings
//
// The GLSL is the lab's (extracted verbatim; tunable numbers replaced by K_* defines from runtime-person.toml [contact],
// [shadow]). `personShader(material, ...)` installs all three on one material; the depth material for the shadow map
// gets the skinning and contact parts (personDepthMaterial).
import * as THREE from "three";
import { section, glslDefines } from "./params.ts";

/** Contact rows: 0 the seat pan, 1 the backrest, SLAB_ROW... up to SLABS hard shells beside the body (rig-binding.ts `slab`: the pods'
 *  inner sides; MV-core, 2026-11-25), PLANES - 1 the parameters; then the capsules; then a sink map per surface (pan, backrest, slabs). */
export const SLAB_ROW = 2, SLABS = 4, PLANES = SLAB_ROW + SLABS + 1, CAPSULES = 8, ROWS = PLANES + CAPSULES, SINK = 64, TEXW = SINK, MAPS = 2 + SLABS, PROFILE_MAX = 48, SLAB_MAX = TEXW - 8;
const CS = section("contact").shader, SL = section("contact").slab, SH = section("shadow");
const C = THREE.ShaderChunk as Record<string, string>;

const CONTACT_DEFINES = glslDefines({ thigh_min: CS.thigh_min, reach: CS.reach, side_reach: CS.side_reach, soft_depth: CS.soft_depth, pan_box: CS.pan_box, back_box: CS.back_box,
  back_above_pan: CS.back_above_pan, back_floor: CS.back_floor, over_sink: CS.over_sink, capsule: CS.capsule, plane_reach: CS.plane_reach, plane_depth_share: CS.plane_depth_share,
  up_min: CS.up_min, normal_probe: CS.normal_probe, sink_range: CS.sink_range, slab_depth: SL.depth, slab_knee: SL.knee }, "K_C_");
const SHADOW_DEFINES = glslDefines({ tap_falloff: SH.tap_falloff, slope_max: SH.slope_max, depth_bias: SH.depth_bias, backface: SH.backface, disc_min_texels: SH.disc_min_texels,
  disc_min: SH.disc_min, disc_max: SH.disc_max, probes: SH.probes, probe_weights: SH.probe_weights, lit: SH.lit, seam: SH.seam, wide_from: SH.wide_from }, "K_SH_")
  + [["P0", SH.probe_taps[0]], ["P1", SH.probe_taps[1]], ["P2", SH.probe_taps[2]], ["P3", SH.probe_taps[3]], ["NWIDE", SH.wide_taps], ["NNARROW", SH.narrow_taps], ["CN", SH.contact_taps], ["QUICK0", SH.quick_taps[0]], ["QUICK1", SH.quick_taps[1]]]
    .map(([k, v]) => `#define LAB_SH_${k} ${Math.round(v as number)}`).join("\n") + `\n#define LAB_SH_CR ${Number(SH.contact_disc).toFixed(1)}\n#define LAB_SH_RANGE personShadowRange\n#define LAB_SH_FAST 1\n`;

// ---- dual-quaternion skinning, eight influences (lab dqs.ts) --------------------------------------------------------------
const DQS_PARS = /* glsl */ `
#ifdef USE_SKINNING
	attribute float _dqs;
	attribute vec4 skinIndex1; attribute vec4 skinWeight1;      // the second set of four influences (glTF JOINTS_1 / WEIGHTS_1); zeros when a vertex has four
	mat4 labBone4 = mat4( 0.0 ), labBone5 = mat4( 0.0 ), labBone6 = mat4( 0.0 ), labBone7 = mat4( 0.0 ); float labW1 = 0.0;
	vec4 labQr = vec4( 0.0, 0.0, 0.0, 1.0 ); vec4 labQd = vec4( 0.0 ); float labDqs = 0.0;
	vec4 labQuat( const in mat3 m ) {
		float tr = m[0][0] + m[1][1] + m[2][2];
		if ( tr > 0.0 ) { float s = sqrt( tr + 1.0 ) * 2.0; return vec4( ( m[1][2] - m[2][1] ) / s, ( m[2][0] - m[0][2] ) / s, ( m[0][1] - m[1][0] ) / s, 0.25 * s ); }
		if ( m[0][0] > m[1][1] && m[0][0] > m[2][2] ) { float s = sqrt( 1.0 + m[0][0] - m[1][1] - m[2][2] ) * 2.0; return vec4( 0.25 * s, ( m[1][0] + m[0][1] ) / s, ( m[2][0] + m[0][2] ) / s, ( m[1][2] - m[2][1] ) / s ); }
		if ( m[1][1] > m[2][2] ) { float s = sqrt( 1.0 + m[1][1] - m[0][0] - m[2][2] ) * 2.0; return vec4( ( m[1][0] + m[0][1] ) / s, 0.25 * s, ( m[2][1] + m[1][2] ) / s, ( m[2][0] - m[0][2] ) / s ); }
		float s = sqrt( 1.0 + m[2][2] - m[0][0] - m[1][1] ) * 2.0; return vec4( ( m[2][0] + m[0][2] ) / s, ( m[2][1] + m[1][2] ) / s, 0.25 * s, ( m[0][1] - m[1][0] ) / s );
	}
	vec4 labDual( const in vec4 q, const in vec3 t ) { return 0.5 * vec4( t * q.w + cross( t, q.xyz ), - dot( t, q.xyz ) ); }
	vec3 labRotate( const in vec4 q, const in vec3 v ) { return v + 2.0 * cross( q.xyz, cross( q.xyz, v ) + q.w * v ); }
#endif
`;
const DQS_BASE = /* glsl */ `
#ifdef USE_SKINNING
	labDqs = clamp( _dqs, 0.0, 1.0 );
	labW1 = skinWeight1.x + skinWeight1.y + skinWeight1.z + skinWeight1.w;
	if ( labW1 > 0.0 ) { labBone4 = getBoneMatrix( skinIndex1.x ); labBone5 = getBoneMatrix( skinIndex1.y ); labBone6 = getBoneMatrix( skinIndex1.z ); labBone7 = getBoneMatrix( skinIndex1.w ); }
	if ( labDqs > 0.001 ) {
		vec4 q0 = labQuat( mat3( boneMatX ) ), q1 = labQuat( mat3( boneMatY ) ), q2 = labQuat( mat3( boneMatZ ) ), q3 = labQuat( mat3( boneMatW ) );
		vec4 w = skinWeight * vec4( 1.0, dot( q0, q1 ) < 0.0 ? - 1.0 : 1.0, dot( q0, q2 ) < 0.0 ? - 1.0 : 1.0, dot( q0, q3 ) < 0.0 ? - 1.0 : 1.0 );
		labQr = q0 * w.x + q1 * w.y + q2 * w.z + q3 * w.w;
		labQd = labDual( q0, boneMatX[3].xyz ) * w.x + labDual( q1, boneMatY[3].xyz ) * w.y + labDual( q2, boneMatZ[3].xyz ) * w.z + labDual( q3, boneMatW[3].xyz ) * w.w;
		if ( labW1 > 0.0 ) {
			vec4 q4 = labQuat( mat3( labBone4 ) ), q5 = labQuat( mat3( labBone5 ) ), q6 = labQuat( mat3( labBone6 ) ), q7 = labQuat( mat3( labBone7 ) );
			vec4 v = skinWeight1 * vec4( dot( q0, q4 ) < 0.0 ? - 1.0 : 1.0, dot( q0, q5 ) < 0.0 ? - 1.0 : 1.0, dot( q0, q6 ) < 0.0 ? - 1.0 : 1.0, dot( q0, q7 ) < 0.0 ? - 1.0 : 1.0 );
			labQr += q4 * v.x + q5 * v.y + q6 * v.z + q7 * v.w;
			labQd += labDual( q4, labBone4[3].xyz ) * v.x + labDual( q5, labBone5[3].xyz ) * v.y + labDual( q6, labBone6[3].xyz ) * v.z + labDual( q7, labBone7[3].xyz ) * v.w;
		}
		float len = max( length( labQr ), 1e-6 ); labQr /= len; labQd /= len;
	}
#endif
`;
const DQS_SKIN = /* glsl */ `if ( labW1 > 0.0 ) skinned += ( labBone4 * skinWeight1.x + labBone5 * skinWeight1.y + labBone6 * skinWeight1.z + labBone7 * skinWeight1.w ) * skinVertex;
	if ( labDqs > 0.001 ) {
		vec3 labP = labRotate( labQr, skinVertex.xyz ) + 2.0 * ( labQr.w * labQd.xyz - labQd.w * labQr.xyz + cross( labQr.xyz, labQd.xyz ) );
		skinned = vec4( mix( skinned.xyz / max( skinned.w, 1e-6 ), labP, labDqs ), 1.0 );
	}
	transformed = ( bindMatrixInverse * skinned ).xyz;`;
// ---- contact (lab contact.ts) ---------------------------------------------------------------------------------------------
/** A shell's cross-section at one place along it (MV-core): the signed distance of a point (h out of the face, y up) and the outward
 *  normal there (in h, y). The face runs from u0 up and is closed at the top: the plate and the joystick base stand above the shell,
 *  so flesh is never squeezed over it; the bottom edge is rounded by R; there is no back (as for soft tissue on the pan: flesh pressed
 *  in deep is still brought out to the front, never through to the far side). Shared by the contact and the sink pass. */
const SHELL_SD = /* glsl */ `
	vec3 labShellSd( float h, float y, float u0, float u1, float R ) {
		float D = K_C_SOFT_DEPTH; R = min( R, 0.5 * max( u1 - u0, 0.0 ) );
		vec2 p2 = vec2( h + 0.5 * D, y - u0 - 0.5 * D ), q2 = abs( p2 ) - vec2( 0.5 * D - R ), m2 = max( q2, 0.0 );
		float l2 = length( m2 ), d = l2 + min( max( q2.x, q2.y ), 0.0 ) - R;
		vec2 g = l2 > 1e-6 ? m2 / l2 : ( q2.x > q2.y ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 ) ); g *= sign( p2 ) + step( 0.0, - abs( p2 ) );
		return vec3( d, g );
	}
`;
const CONTACT_PARS = CONTACT_DEFINES + /* glsl */ `
#ifdef USE_SKINNING
	uniform highp sampler2D labContact;
	attribute vec4 _contact;      // x, y: receiver regions; z: limb surfaces; w is not used (a mesh without the attribute reads w = 1)
	vec4 labT( int i, int r ) { return texelFetch( labContact, ivec2( i, r ), 0 ); }
	// the real cushion's centre-line top (rig-binding.ts, profile), as heights over the pan's flat top by depth w: row 0, texel 4 holds
	// the count, texels 8... the samples (w, height); 0 samples = the flat slab (MV-core, 2026-11-25, not in the lab)
	float labProfile( float w ) {
		int n = int( labT( 4, 0 ).x + 0.5 ); if ( n < 2 ) return 0.0;
		vec4 a = labT( 8, 0 ); if ( w <= a.x ) return a.y;
		for ( int i = 1; i < ${PROFILE_MAX}; i ++ ) { if ( i >= n ) break; vec4 b = labT( 8 + i, 0 ); if ( w <= b.x ) return mix( a.y, b.y, ( w - a.x ) / max( b.x - a.x, 1e-6 ) ); a = b; }
		return a.y;
	}
	vec3 labCapsules( vec3 x ) {
		vec3 m = _contact.xyz; if ( m.x + m.y + m.z <= 0.0 ) return x;
		vec3 sum = vec3( 0.0 );
		for ( int r = ${PLANES}; r < ${ROWS}; r ++ ) {
			vec4 c = labT( 2, r ); if ( c.y < 0.5 ) continue;       // c: receiver channel (0 = x, 1 = y, 2 = none), on, knee, lip full (0 = no lip)
			vec4 a = labT( 0, r ), b = labT( 1, r );     // end points with their radii
			vec3 ab = b.xyz - a.xyz; float t = clamp( dot( x - a.xyz, ab ) / max( dot( ab, ab ), 1e-8 ), 0.0, 1.0 );
			vec3 q = x - ( a.xyz + ab * t ); float d = length( q ), rad = mix( a.w, b.w, t ); vec3 n = d > 1e-5 ? q / d : vec3( 0.0, 1.0, 0.0 );
			float w = c.x < 0.5 ? m.x : c.x < 1.5 ? m.y : 0.0;
			vec4 u = labT( 3, r );                                                               // u.xyz: the limb's own give, u.w: lip none
			if ( w > 0.0 && d < rad + K_C_CAPSULE.x * c.z ) { float z = ( d - rad ) / c.z, push = c.z * ( z < -20.0 ? - z : log( 1.0 + exp( - z ) ) );
				if ( u.w > c.w ) push *= 1.0 - smoothstep( c.w, u.w, rad - d );                    // the lip: skin deeper than "full" is brought out less, beyond "none" not at all
				sum += n * ( push * w ); }
			if ( m.z > 0.0 && d < rad * K_C_CAPSULE.z ) {                                                    // the limb's own surface gives way a little toward what it rests on
				float len = length( u.xyz );
				if ( len > 1e-6 ) { float f = max( dot( n, u.xyz / len ), 0.0 ); sum -= n * ( len * f * f * m.z * ( 1.0 - smoothstep( rad * K_C_CAPSULE.y, rad * K_C_CAPSULE.z, d ) ) ); }
			}
		}
		return x + sum;
	}
	// The seat pan: a slab with square sides and a rounded front edge (edge radius R; with the full thickness T = 2 R the front is a
	// bull-nose). Returns the push as a vector, x0 is the rest position (for the masks). Rows: t0 = up normal, R; t1 = the top surface
	// at the middle of the front edge, T; t2 = half width, mode (2), rest knee height, rest hip height; t3 = rear (metres behind the
	// front edge), rest hip x, -, -. Row ${PLANES - 1}: k0 = knee, lip knee full, none, bulge; k1 = lip thigh full, none, bulge knee, side;
	// k2 = mask from, to (fractions of the thigh above the knee), mask x from, to.
	// round 7: a sink map (bilinear; 0 outside it). box = its extent in the contact surface's own coordinates (from u, to u, from w, to w)
	float labSinkAt( vec2 p, vec4 box, int map ) {
		vec2 t = vec2( ( p.x - box.x ) / ( box.y - box.x ), ( p.y - box.z ) / ( box.w - box.z ) ) * ${SINK}.0 - 0.5;
		if ( t.x < 0.0 || t.y < 0.0 || t.x > ${SINK - 1}.0 || t.y > ${SINK - 1}.0 ) return 0.0;
		int o = ${ROWS} + map * ${SINK}; ivec2 i = ivec2( floor( t ) ), j = min( i + 1, ivec2( ${SINK - 1} ) ); vec2 fr = t - vec2( i );
		float a = texelFetch( labContact, ivec2( i.x, o + i.y ), 0 ).r, b = texelFetch( labContact, ivec2( j.x, o + i.y ), 0 ).r;
		float c = texelFetch( labContact, ivec2( i.x, o + j.y ), 0 ).r, d = texelFetch( labContact, ivec2( j.x, o + j.y ), 0 ).r;
		return mix( mix( a, b, fr.x ), mix( c, d, fr.x ), fr.y );
	}
	// The displaced tissue put back (round 7), for one contact surface: p = the skin point in the surface's own coordinates, h = its
	// height above the surface. Skin beside the sink (not over it) is moved away from it, within the surface, by the sink's area from
	// here inward to its crest (the tissue displaced on this side), spread as a soft roll over the height: 4 t e^(-2t) / spread, t = h / spread.
	// Returns the move in the surface's coordinates (2D); k3 = normals, cap, spread, volume.
	// the roll field of a map, bilinear: x = area to put back per metre of rim (already 0 over the sink), yz = the direction toward the sink
	vec3 labFieldAt( vec2 p, vec4 box, int map ) {
		vec2 t = vec2( ( p.x - box.x ) / ( box.y - box.x ), ( p.y - box.z ) / ( box.w - box.z ) ) * ${SINK}.0 - 0.5;
		if ( t.x < 0.0 || t.y < 0.0 || t.x > ${SINK - 1}.0 || t.y > ${SINK - 1}.0 ) return vec3( 0.0 );
		int o = ${ROWS} + map * ${SINK}; ivec2 i = ivec2( floor( t ) ), j = min( i + 1, ivec2( ${SINK - 1} ) ); vec2 fr = t - vec2( i );
		vec3 a = texelFetch( labContact, ivec2( i.x, o + i.y ), 0 ).gba, b = texelFetch( labContact, ivec2( j.x, o + i.y ), 0 ).gba;
		vec3 c = texelFetch( labContact, ivec2( i.x, o + j.y ), 0 ).gba, d = texelFetch( labContact, ivec2( j.x, o + j.y ), 0 ).gba;
		return mix( mix( a, b, fr.x ), mix( c, d, fr.x ), fr.y );
	}
	// The displaced tissue put back (round 7), for one contact surface: p = the skin point in the surface's own coordinates, h = its
	// height above the surface. The field (built on the CPU from the sink map, smoothed: see rollField in contact.ts) says how much
	// tissue this part of the rim has to take and in which direction the sink lies; it is spread over the height as a soft roll,
	// 4 t e^(-2t) / spread with t = h / spread (0 on the contact line, integral 1). Returns the move in the surface's coordinates.
	vec2 labRoll( vec2 p, float h, vec4 box, int map, vec4 k3 ) {
		if ( h > K_C_REACH.y * k3.z || h < 0.0 ) return vec2( 0.0 );
		vec3 fd = labFieldAt( p, box, map ); float dl = length( fd.yz ); if ( dl < 1e-4 || fd.x <= 0.0 ) return vec2( 0.0 );
		float over = 1.0 - smoothstep( 0.0, K_C_OVER_SINK, labSinkAt( p, box, map ) ), t = h / k3.z;        // skin over the sink itself does not roll out
		return - ( fd.yz / dl ) * min( k3.w * fd.x * 4.0 * t * exp( - 2.0 * t ) / k3.z, k3.y ) * over;
	}
	// the rest-position mask of the seat contact: thigh, buttock and back 1; knee, calf, arms 0 (row r: the pan)
	float labContactMask( vec3 x0, int r ) {
		vec4 t2 = labT( 2, r ), k2 = labT( 2, ${PLANES - 1} ); float kneeY = t2.z, L = max( t2.w - kneeY, K_C_THIGH_MIN );
		return smoothstep( kneeY + k2.x * L, kneeY + k2.y * L, x0.y ) * ( 1.0 - smoothstep( k2.z, k2.w, abs( x0.x ) ) );
	}
	vec3 labPan( vec3 x, vec3 x0, int r, inout vec3 roll ) {
		vec4 t0 = labT( 0, r ), t1 = labT( 1, r ), t2 = labT( 2, r ), t3 = labT( 3, r );
		vec4 k0 = labT( 0, ${PLANES - 1} ), k1 = labT( 1, ${PLANES - 1} ), k2 = labT( 2, ${PLANES - 1} ), k3 = labT( 3, ${PLANES - 1} );   // k3: normals, cap, spread, volume (0 = no sink map)
		vec3 n = t0.xyz, f = normalize( vec3( 0.0, 0.0, 1.0 ) - n * n.z ), s = cross( n, f );
		float R = t0.w, T = t1.w, hw = t2.x, rear = t3.x, kn = k0.x, kb = k1.z;
		vec3 rel = x - t1.xyz; float v = dot( rel, n ), w = dot( rel, f ), u = dot( rel, s );
		if ( r == 0 ) v -= labProfile( w );                                                     // the real cushion's top (MV-core)
		float reach = max( K_C_REACH.x * kb, k3.w > 0.0 ? K_C_REACH.y * k3.z : 0.0 ), side7 = k3.w > 0.0 ? K_C_SIDE_REACH : 0.0;
		if ( v > reach || w > kn + K_C_REACH.x * kb || w < - rear - kn - side7 || abs( u ) > hw + kn + K_C_REACH.x * kb + side7 ) return vec3( 0.0 );
		// what this vertex is: thigh and buttock (1) or knee, calf, anything else (0), from where it is at rest
		float kneeY = t2.z, L = max( t2.w - kneeY, K_C_THIGH_MIN );
		float m = smoothstep( kneeY + k2.x * L, kneeY + k2.y * L, x0.y ) * ( 1.0 - smoothstep( k2.z, k2.w, abs( x0.x ) ) );
		// for soft tissue the pan has no bottom (flesh that sank deep is still brought up, never pushed out underneath); for the rest
		// it is the drawn slab, so a calf that passes in front of the seat is touched only near the faces it crosses
		float Te = mix( T, K_C_SOFT_DEPTH, m ); if ( v < - Te - kn ) return vec3( 0.0 );
		// the pan's profile in its own frame (v up, w forward; the top at v = 0, the front edge at w = 0): a rounded rectangle whose
		// front corners have the radius R (with T = 2 R the front is a bull-nose), extruded sideways between square sides at |u| = hw
		vec2 p2 = vec2( w + 0.5 * rear, v + 0.5 * Te ), h2 = vec2( 0.5 * rear, 0.5 * Te ), q2 = abs( p2 ) - ( h2 - R ), m2 = max( q2, 0.0 );
		float l2 = length( m2 ), d2 = l2 + min( max( q2.x, q2.y ), 0.0 ) - R;
		vec2 g2 = l2 > 1e-6 ? m2 / l2 : ( q2.x > q2.y ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 ) ); g2 *= sign( p2 ) + step( 0.0, - abs( p2 ) );
		vec2 e2 = vec2( d2, abs( u ) - hw ), me = max( e2, 0.0 ); float le = length( me ), d = le + min( max( e2.x, e2.y ), 0.0 );   // signed distance, negative inside
		vec2 ge = le > 1e-6 ? me / le : ( e2.x > e2.y ? vec2( 1.0, 0.0 ) : vec2( 0.0, 1.0 ) );
		vec3 nrm = ( f * g2.x + n * g2.y ) * ge.x + s * ( ( u < 0.0 ? - 1.0 : 1.0 ) * ge.y );           // outward normal of the pan surface nearest to x
		float e = - d;                                                                                 // how deep inside the pan
		float push = e <= - kn ? 0.0 : e >= kn ? e : ( e + kn ) * ( e + kn ) / ( 4.0 * kn );          // the rigging lead's quadratic knee
		push *= 1.0 - smoothstep( mix( k0.y, k1.x, m ), mix( k0.z, k1.y, m ), e );                   // the lip: what may be moved, by what it is
		vec3 out_ = nrm * push;
		if ( m > 0.0 && k0.w > 0.0 ) {                                                                 // the displaced flesh bulges sideways, perpendicular to the thigh
			float side = clamp( ( abs( x0.x ) - t3.y ) / k1.w, - 1.0, 1.0 ) * ( x0.x < 0.0 ? - 1.0 : 1.0 );
			float z = e / kb, sp = k0.w * kb * ( z > 20.0 ? z : log( 1.0 + exp( z ) ) ), cap = max( labT( 3, ${PLANES - 1} ).y, 1e-4 );      // capped (bulgeMax)
			out_ += s * ( m * cap * tanh( sp / cap ) * side );
		}
		if ( m > 0.0 && k3.w > 0.0 ) {                                                                // round 7: the displaced tissue goes out of the side and the back
			vec2 mv = labRoll( vec2( u, w ), v, vec4( - hw, hw, - rear - K_C_PAN_BOX.x, K_C_PAN_BOX.y ), 0, k3 ) * m;
			vec3 dd = s * mv.x + f * mv.y;
			vec4 bc = labT( 2, 1 );                                                                     // toward the backrest the roll is a soft minimum of itself and the room left
			if ( r == 0 && bc.y > 0.5 && bc.y < 1.5 ) { vec4 ba = labT( 0, 1 ), bb = labT( 1, 1 ); float room = max( dot( x - bb.xyz, ba.xyz ), 0.0 ), into = dot( dd, - ba.xyz );
				if ( into > 0.0 ) dd += ba.xyz * ( into - into * room / ( room + into + 1e-4 ) ); }
			roll += dd;                                                                                 // added after the blend of seat and backrest, so the corner does not thin it
		}
		return out_;
	}
	// A hard shell beside the body (rig-binding.ts slab; MV-core, 2026-11-25, not in the lab): the pods' inner sides. Its face toward the
	// body is a height field along the shell: at a (along forward) it stands out H(a) along the normal, between u0(a) and u1(a) along up,
	// its top and bottom rounded by the edge radius. Flesh pressed into it is brought out as on the seat (the quadratic knee, the lip by
	// the seat's mask, the displaced tissue as a roll from the shell's own sink map); skin more than K_C_SLAB_DEPTH behind the face is not
	// this shell's. Row r: t0 = normal, edge; t1 = point, highest H; t2 = -, mode (3), map, -; t3 = forward; t4 = samples, first a,
	// step; t5 = up; t6 = the map's box (up from, to, along from, to); t8... = (H, u0, u1) every step. hard: only what is still inside, no knee.
	${SHELL_SD}
	vec3 labSlabAt( int r, float a ) {
		vec4 h = labT( 4, r ); float t = clamp( ( a - h.y ) / max( h.z, 1e-6 ), 0.0, h.x - 1.0 ); int i = clamp( int( t ), 0, int( h.x + 0.5 ) - 2 );
		return mix( labT( 8 + i, r ).xyz, labT( 9 + i, r ).xyz, t - float( i ) );
	}
	vec3 labSlab( vec3 x, vec3 x0, int r, inout vec3 roll, bool hard ) {
		vec4 t0 = labT( 0, r ), t1 = labT( 1, r ), k3 = labT( 3, ${PLANES - 1} ); vec3 n = t0.xyz, rel = x - t1.xyz; float v = dot( rel, n );
		float kn = K_C_SLAB_KNEE, reach = max( K_C_REACH.x * kn, k3.w > 0.0 ? K_C_REACH.y * k3.z : 0.0 );
		if ( v > t1.w + reach ) return vec3( 0.0 );
		vec4 hd = labT( 4, r ); vec3 f = labT( 3, r ).xyz, up = labT( 5, r ).xyz;
		float a = dot( rel, f ), y = dot( rel, up ), a0 = hd.y, a1 = hd.y + hd.z * ( hd.x - 1.0 );
		if ( a < a0 - reach || a > a1 + reach ) return vec3( 0.0 );
		vec3 sa = labSlabAt( r, a ); float u0 = sa.y, u1 = sa.z, h = v - sa.x;
		if ( h > reach || h < - K_C_SLAB_DEPTH - kn || y < u0 - reach || y > u1 + reach ) return vec3( 0.0 );
		float m = labT( 2, 0 ).y > 1.5 ? labContactMask( x0, 0 ) : 0.0;                                // thigh, buttock, trunk 1; knee, calf, arms 0 (the seat's mask)
		vec4 k0 = labT( 0, ${PLANES - 1} ), k1 = labT( 1, ${PLANES - 1} );
		// the cross-section (labShellSd): flesh is brought out across the shell, never along it (a thigh lies along a pod: pushed out
		// over the pod's end it would be stretched along itself). Above the top edge (u1) the shell gives way to the open gap under the
		// joystick base, and at its ends the shell stops (the profile curves away there): the push fades out over the edge radius at both.
		vec3 sd = labShellSd( h, y, u0, u1, t0.w ); float R = min( t0.w, 0.5 * max( u1 - u0, 0.0 ) ), Re = max( t0.w, 1e-4 );
		vec3 nrm = n * sd.y + up * sd.z;
		float e = - sd.x, top = ( 1.0 - smoothstep( u1 - R, u1 + R, y ) ) * smoothstep( a0 - Re, a0 + Re, a ) * ( 1.0 - smoothstep( a1 - Re, a1 + Re, a ) );
		if ( hard ) return nrm * ( max( e, 0.0 ) * top );                                                // after everything else: nothing stays inside
		float push = e <= - kn ? 0.0 : e >= kn ? e : ( e + kn ) * ( e + kn ) / ( 4.0 * kn );
		push *= ( 1.0 - smoothstep( mix( k0.y, k1.x, m ), mix( k0.z, k1.y, m ), e ) ) * top;          // the lip, as on the seat
		if ( m > 0.0 && k3.w > 0.0 ) { vec2 mv = labRoll( vec2( y, a ), h, labT( 6, r ), int( labT( 2, r ).z + 0.5 ), k3 ) * m; roll += up * mv.x + f * mv.y; }
		return nrm * push;
	}
	// the roll of displaced tissue (the seat's, sideways) stops at a shell: toward its face it is a soft minimum of itself and the room
	// left, as at the backrest (MV-core: without it the seat's roll put 9 to 21 mm of thigh into the pods)
	vec3 labShellRoom( vec3 x, vec3 dd ) {
		for ( int r = ${SLAB_ROW}; r < ${SLAB_ROW + SLABS}; r ++ ) {
			if ( labT( 2, r ).y < 2.5 ) continue;
			vec4 t0 = labT( 0, r ), t1 = labT( 1, r ); vec3 n = t0.xyz, rel = x - t1.xyz; float into = dot( dd, - n ); if ( into <= 0.0 ) continue;
			vec4 hd = labT( 4, r ); vec3 f = labT( 3, r ).xyz, up = labT( 5, r ).xyz; float a = dot( rel, f ), y = dot( rel, up );
			if ( a < hd.y || a > hd.y + hd.z * ( hd.x - 1.0 ) ) continue;
			vec3 sa = labSlabAt( r, a ); float h = dot( rel, n ) - sa.x; if ( y < sa.y - t0.w || y > sa.z + t0.w || h < - K_C_SLAB_DEPTH ) continue;
			float room = max( h, 0.0 ); dd += n * ( into - into * room / ( room + into + 1e-4 ) );
		}
		return dd;
	}
	vec3 labFlatten( vec3 x, vec3 x0 ) {
		x = labCapsules( x );
		// every plane (and the pan) is evaluated on the same point and the pushes are blended: at the corner of seat and backrest the
		// two meet in a rounded fillet instead of one result being creased by the other
		vec3 sum = vec3( 0.0 ), roll = vec3( 0.0 ); float total = 0.0, biggest = 0.0;
		for ( int r = 0; r < ${PLANES - 1}; r ++ ) {
			vec4 c = labT( 2, r ); if ( c.y < 0.5 ) continue;       // planes: c = press-in limit, on (1), bulge, radius; the pan: c.y = 2
			vec3 dv = vec3( 0.0 ); float push = 0.0;
			if ( c.y > 2.5 ) { dv = labSlab( x, x0, r, roll, false ); push = length( dv ); }
			else if ( c.y > 1.5 ) { dv = labPan( x, x0, r, roll ); push = length( dv ); }
			else {
				vec4 a = labT( 0, r ), b = labT( 1, r ), e = labT( 3, r );   // a.xyz normal, b.xyz point, e: knee, fade, depth
				float d = dot( x - b.xyz, a.xyz ), lim = - c.x;
				if ( d <= lim + K_C_PLANE_REACH * e.x ) {
					vec3 tang = ( x - b.xyz ) - a.xyz * d; float rad = length( tang );
					float w = ( 1.0 - smoothstep( c.w, c.w + e.y, rad ) ) * smoothstep( lim - e.z, lim - e.z * K_C_PLANE_DEPTH_SHARE, d );
					if ( r == 1 && labT( 3, ${PLANES - 1} ).w > 0.0 && labT( 2, 0 ).y > 1.5 ) w *= smoothstep( K_C_BACK_ABOVE_PAN.x, K_C_BACK_ABOVE_PAN.y, x.y - labT( 1, 0 ).y );   // round 7: the backrest stands on the pan; below its top the pan alone holds the flesh
					if ( w > 0.0 ) { float z = ( d - lim ) / e.x; push = ( lim + e.x * ( z > 20.0 ? z : log( 1.0 + exp( z ) ) ) - d ) * w;
						if ( r == 1 && labT( 3, ${PLANES - 1} ).w > 0.0 && labT( 2, 0 ).y > 1.5 ) { float pe = lim - d, kq = e.x;      // round 7: the quadratic knee, as on the pan: the
							push = ( pe <= - kq ? 0.0 : pe >= kq ? pe : ( pe + kq ) * ( pe + kq ) / ( 4.0 * kq ) ) * w; }               // softplus tail pressed a whole back in by millimetres
						dv = a.xyz * push + ( rad > 1e-4 ? tang / rad : vec3( 0.0 ) ) * ( push * c.z ); }
				}
				vec4 k3 = labT( 3, ${PLANES - 1} );
				if ( r == 1 && k3.w > 0.0 && labT( 2, 0 ).y > 1.5 ) {                                      // round 7: the backrest's displaced tissue rolls out sideways and up
					vec3 nb = a.xyz, up = normalize( vec3( 0.0, 1.0, 0.0 ) - nb * nb.y ), sx = normalize( cross( up, nb ) );
					float top = labT( 1, 0 ).y; vec3 o = b.xyz + up * ( ( top - b.y ) / max( up.y, K_C_UP_MIN ) ), q = x - o;
					float m = labContactMask( x0, 0 );
					if ( m > 0.0 ) { vec2 mv = labRoll( vec2( dot( q, sx ), dot( q, up ) ), dot( q, nb ), K_C_BACK_BOX, 1, k3 ) * m;
						mv.y = max( mv.y, - max( dot( q, up ) - K_C_BACK_FLOOR, 0.0 ) );                                   // not down into the seat
						roll += sx * mv.x + up * mv.y; }
				}
			}
			if ( push < 1e-7 ) continue;
			sum += dv * push; total += push; biggest = max( biggest, push );
		}
		vec3 xb = total > 1e-7 ? x + sum / total * ( 0.5 + 0.5 * biggest / total ) : x;
		if ( labT( 3, ${PLANES - 1} ).w > 0.0 && labT( 2, 0 ).y > 1.5 ) { vec3 none = vec3( 0.0 ); xb += labPan( xb, x0, 0, none ); }     // round 7: where seat and backrest were blended, the pan still holds
		xb += labShellRoom( xb, roll );
		for ( int r = ${SLAB_ROW}; r < ${SLAB_ROW + SLABS}; r ++ ) if ( labT( 2, r ).y > 2.5 ) { vec3 none = vec3( 0.0 ); xb += labSlab( xb, x0, r, none, true ); }   // and a hard shell holds what is still in it (MV-core)
		return xb;
	}
#endif
`;
const SHADES = "( defined( STANDARD ) || defined( LAMBERT ) || defined( PHONG ) || defined( TOON ) || defined( MATCAP ) || defined( NORMAL ) ) && ! defined( FLAT_SHADED )";
const CONTACT_APPLY = /* glsl */ `vec3 labRest = transformed, labSk = ( bindMatrixInverse * skinned ).xyz;
	#ifdef LAB_SINKPASS
	transformed = labSk;
	#else
	transformed = labFlatten( labSk, labRest );
	#endif
	#if ${SHADES} && ! defined( LAB_SINKPASS )
	if ( texelFetch( labContact, ivec2( 3, ${PLANES - 1} ), 0 ).x > 0.5 && distance( transformed, labSk ) > 1e-5 ) {
		vec3 nn = normalize( objectNormal ), ta = normalize( abs( nn.y ) < 0.9 ? cross( nn, vec3( 0.0, 1.0, 0.0 ) ) : cross( nn, vec3( 1.0, 0.0, 0.0 ) ) ), tb = cross( nn, ta );
		const float h = K_C_NORMAL_PROBE;
		vec3 da = labFlatten( labSk + ta * h, labRest ) - transformed, db = labFlatten( labSk + tb * h, labRest ) - transformed;
		vec3 nb = cross( da, db ); if ( dot( nb, nn ) < 0.0 ) nb = - nb;
		if ( dot( nb, nb ) > 1e-14 ) { vec3 tn = normalMatrix * normalize( nb );
			#ifdef FLIP_SIDED
			tn = - tn;
			#endif
			transformedNormal = tn; vNormal = normalize( tn ); }
	}
	#endif`;

const LINE = "transformed = ( bindMatrixInverse * skinned ).xyz;";
function must(s: string, find: string, what: string) { if (!s.includes(find)) throw new Error(`person shader: three.js chunk changed (${what})`); return s; }
const SKIN_PARS = C.skinning_pars_vertex + DQS_PARS + CONTACT_PARS;
const SKIN_BASE = C.skinbase_vertex + DQS_BASE;
const SKINNING = must(must(C.skinning_vertex, LINE, "skinning_vertex").replace(LINE, DQS_SKIN), LINE, "dqs result").replace(LINE, CONTACT_APPLY);
const SKIN_NORMAL = must(C.skinnormal_vertex, "mat4 skinMatrix = mat4( 0.0 );", "skinnormal_vertex").replace("mat4 skinMatrix = mat4( 0.0 );", "vec3 labN0 = objectNormal;\n\tmat4 skinMatrix = mat4( 0.0 );")
  .replace("skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;", "if ( labW1 > 0.0 ) skinMatrix += labBone4 * skinWeight1.x + labBone5 * skinWeight1.y + labBone6 * skinWeight1.z + labBone7 * skinWeight1.w;\n\tskinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;")
  .replace("objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;", `objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	if ( labDqs > 0.001 ) objectNormal = mix( normalize( objectNormal ), mat3( bindMatrixInverse ) * labRotate( labQr, mat3( bindMatrix ) * labN0 ), labDqs );   // bone matrices are in world space: back into the mesh's own frame, as three does for the linear normal`);
if (!SKIN_NORMAL.includes("labN0") || !SKIN_NORMAL.includes("labBone4") || !SKIN_NORMAL.includes("labRotate")) throw new Error("person shader: skinnormal_vertex changed");

// ---- soft shadows on the person (lab studio.ts) ------------------------------------------------------------------------------
const SOFT = /* glsl */ `
		// hardware-filtered comparisons over a fixed Vogel disc: radius in uv, depth plane z + g . offset
		float labPcf( sampler2DShadow m, vec2 uv, float z, vec2 g, float r, const int n ) {
			float s = 0.0, w = 0.0;
			for ( int i = 0; i < n; i ++ ) {
				vec2 o = vogelDiskSample( i, n, 0.0 ); float k = 1.0 - K_SH_TAP_FALLOFF * dot( o, o ); o *= r;
				s += k * texture( m, vec3( uv + o, z + dot( g, o ) ) ); w += k;
			}
			return s / w;
		}
		float labNdotL = 1.0;      // set by the light loop just before each directional light's shadow (round 9)
		float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			shadowCoord.xyz /= shadowCoord.w;
			// the receiver plane, before any branch (derivatives need the whole pixel quad)
			vec3 dx = dFdx( shadowCoord.xyz ), dy = dFdy( shadowCoord.xyz );
			float det = dx.x * dy.y - dx.y * dy.x;
			vec2 g = abs( det ) > 1e-14 ? vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det : vec2( 0.0 );
			float mPerUv = 2.0 * personShadowHalf, uvPerM = 1.0 / mPerUv, dPerM = 1.0 / LAB_SH_RANGE;
			vec2 slope = g * mPerUv * LAB_SH_RANGE; float sl = length( slope ); if ( sl > K_SH_SLOPE_MAX ) slope *= K_SH_SLOPE_MAX / sl;       // metres of depth per metre across
			g = slope * dPerM * mPerUv;
			float texelUv = 1.0 / float( textureSize( shadowMap, 0 ).x );
			float z = shadowCoord.z - ( K_SH_DEPTH_BIAS + min( sl, K_SH_SLOPE_MAX ) * texelUv * mPerUv ) * dPerM;      // 1 mm plus one texel of slope (the bilinear footprint)
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0 && shadowCoord.z <= 1.0;
			if ( ! inFrustum ) return 1.0;
			#if LAB_SH_FAST == 1
			// a surface turned more than 120 degrees from the light gets no direct light at all (the skin's wrapped diffuse reaches 0.42 past the
			// terminator): no filter there. After the derivatives above, so the pixel quad stays uniform.
			if ( labNdotL < K_SH_BACKFACE ) return 1.0;
			#endif
			float tanA = personShadowTan, rMin = max( K_SH_DISC_MIN_TEXELS * texelUv, K_SH_DISC_MIN * uvPerM ), rMax = K_SH_DISC_MAX * uvPerM;      // smallest disc at least 1.8 mm, also when the frustum is fitted to a close view
			#if LAB_SH_FAST == 1
			// Most pixels (the open floor, lit skin) have nothing in front of them: one 12-tap look over the widest disc for anything 15 mm or
			// more in front, then 4 taps for a contact. Only pixels that see something pay for the four probes and the filter. Where the look
			// just starts to see a blocker the full path's result is within a few hundredths of 1, so there is no seam.
			if ( labPcf( shadowMap, shadowCoord.xy, z - K_SH_PROBES.x * dPerM, g, rMax, LAB_SH_QUICK0 ) > K_SH_LIT ) {
				if ( labPcf( shadowMap, shadowCoord.xy, z, g, rMin * LAB_SH_CR, LAB_SH_QUICK1 ) > K_SH_LIT ) return 1.0;
				return mix( 1.0, labPcf( shadowMap, shadowCoord.xy, z, g, rMin * LAB_SH_CR, LAB_SH_CN ), shadowIntensity );
			}
			#endif
			// blocker distance from four probes: occluded fraction of the map nearer than receiver - t, over the disc a blocker at t can reach
			float o0 = 1.0 - labPcf( shadowMap, shadowCoord.xy, z - K_SH_PROBES.x * dPerM, g, clamp( K_SH_PROBES.x * tanA * uvPerM, rMin, rMax ), LAB_SH_P0 );
			float o1 = 1.0 - labPcf( shadowMap, shadowCoord.xy, z - K_SH_PROBES.y * dPerM, g, clamp( K_SH_PROBES.y * tanA * uvPerM, rMin, rMax ), LAB_SH_P1 );
			float o2 = 1.0 - labPcf( shadowMap, shadowCoord.xy, z - K_SH_PROBES.z * dPerM, g, clamp( K_SH_PROBES.z * tanA * uvPerM, rMin, rMax ), LAB_SH_P2 );
			float o3 = 1.0 - labPcf( shadowMap, shadowCoord.xy, z - K_SH_PROBES.w * dPerM, g, clamp( K_SH_PROBES.w * tanA * uvPerM, rMin, rMax ), LAB_SH_P3 );
			float oMax = max( max( o0, o1 ), max( o2, o3 ) );
			// nothing in front within 15 mm..400 mm: only a contact (closer than 15 mm) can still shadow; test it with the smallest disc
			// (round 8: 24 taps over 3 x the smallest disc, were 8 over 2 x: a ridge or crease within 15 mm, the neck's over the throat at 1.2 m,
			// drew a faint stepped line)
			if ( oMax < K_SH_SEAM.x ) { float c = labPcf( shadowMap, shadowCoord.xy, z, g, rMin * LAB_SH_CR, LAB_SH_CN ); return mix( 1.0, c, shadowIntensity ); }
			// mean blocker distance = integral of P(blocker farther than t) dt, trapezoids between the probes, a 0.3 m tail after the last
			float d = dot( K_SH_PROBE_WEIGHTS, vec4( o0, o1, o2, o3 ) ) / oMax;
			float r = clamp( tanA * d * uvPerM, rMin, rMax );
			// a wide disc needs more taps: point taps far apart alias on thin blockers (a finger's shadow on the thigh came out grainy, E28)
			float shadow = r > K_SH_WIDE_FROM * texelUv ? labPcf( shadowMap, shadowCoord.xy, z, g, r, LAB_SH_NWIDE ) : labPcf( shadowMap, shadowCoord.xy, z, g, r, LAB_SH_NNARROW );
			// round 8: no seam where the probes just begin to see a blocker (the ratio above is unsteady there and pixels flipped between the
			// two paths: specks along the edge of the chin's shadow on the throat); the contact result is blended in over that band
			if ( oMax < K_SH_SEAM.y ) shadow = mix( labPcf( shadowMap, shadowCoord.xy, z, g, rMin * LAB_SH_CR, LAB_SH_CN ), shadow, smoothstep( K_SH_SEAM.x, K_SH_SEAM.y, oMax ) );
			return mix( 1.0, shadow, shadowIntensity );
		}`;
const SHADOW_HEAD = "float getShadow( sampler2DShadow shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {";
const SHADOW_PARS = (() => {
  const src = C.shadowmap_pars_fragment, a = src.indexOf(SHADOW_HEAD), b = src.indexOf("return mix( 1.0, shadow, shadowIntensity );", a);
  if (a < 0 || b < 0) throw new Error("person shader: shadowmap_pars_fragment changed");
  const end = src.indexOf("}", b) + 1;
  return src.slice(0, a) + "uniform float personShadowTan; uniform float personShadowHalf; uniform float personShadowRange;\n" + SHADOW_DEFINES + SOFT + src.slice(end);
})();
const CALL = "directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ]";
const LIGHTS_BEGIN = must(C.lights_fragment_begin, CALL, "lights_fragment_begin").replace(CALL, "labNdotL = dot( geometryNormal, directLight.direction );\n\t\t" + CALL);
const NB = "shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );";
const SHADOW_VERTEX = must(C.shadowmap_vertex, NB, "shadowmap_vertex").replace(NB, "shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * personNormalBias, 0 );");

/** Uniforms every person shader shares (one set per person: its contact texture; the shadow numbers of the key light). */
/** personNear: in the operator's own view (the camera on this person's eyes) nothing of the person nearer the camera than this is
 *  drawn, 0 = off. The person's own face otherwise lay across the bottom of the view as a flat skin-coloured sheet, cut by the near
 *  plane (designer, REVIEW-11: "a web across the men's lap"; the nose is 60 mm below and in front of the eye). The shadow pass is
 *  measured from the light, so the head still casts its shadow. */
/** personKey: the person's own soft key (designer, REVIEW-11; [look]), its irradiance (linear RGB; 0 = off), from the camera's side and
 *  above, no shadow; only the person's materials see it, so the rig is lit exactly as before. personLook: 1 the person's own look on
 *  (that key, the crease occlusion, the skin's saturation), 0 the materials as they were (for comparing). */
export interface PersonUniforms { labContact: { value: THREE.Texture }; personShadowTan: { value: number }; personShadowHalf: { value: number }; personShadowRange: { value: number }; personNormalBias: { value: number }; personNear: { value: number }; personKey: { value: THREE.Color }; personLook: { value: number } }
export const newPersonUniforms = (contact: THREE.Texture): PersonUniforms => ({ labContact: { value: contact }, personShadowTan: { value: SH.light_tan }, personShadowHalf: { value: 1 }, personShadowRange: { value: 1 }, personNormalBias: { value: SH.normal_bias }, personNear: { value: 0 }, personKey: { value: new THREE.Color(0, 0, 0) }, personLook: { value: 1 } });

// ---- the person's own look in the product's light (designer, REVIEW-11; numbers in [look]) -------------------------------------
const LK = section("look");
const LOOK_DEFINES = glslDefines({ key_az: LK.key_az * Math.PI / 180, key_el: LK.key_el * Math.PI / 180, cavity: LK.cavity }, "K_LOOK_");
/** A soft key from the camera's side and above, built in view space each fragment (world up from the view matrix), evaluated with
 *  the material's own direct-light model and no shadow. */
const PERSON_KEY = /* glsl */ `
	#if defined( RE_Direct )
	if ( personLook > 0.0 ) {
		vec3 lkUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ), lkH = vec3( 0.0, 0.0, 1.0 ) - lkUp * lkUp.z;
		lkH = dot( lkH, lkH ) > 1e-6 ? normalize( lkH ) : normalize( cross( lkUp, vec3( 1.0, 0.0, 0.0 ) ) );
		vec3 lkA = lkH * cos( K_LOOK_KEY_AZ ) + cross( lkUp, lkH ) * sin( K_LOOK_KEY_AZ );
		IncidentLight lkL; lkL.direction = normalize( lkA * cos( K_LOOK_KEY_EL ) + lkUp * sin( K_LOOK_KEY_EL ) ); lkL.color = personKey * personLook; lkL.visible = true;
		RE_Direct( lkL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#endif
`;
/** Shading in the person's own creases: the per-vertex cavity (avatar.ts cavityOf) darkens the indirect light, and the direct a little. */
const PERSON_OCCLUSION = /* glsl */ `
	{ float lkC = clamp( vPersonCav, 0.0, 1.0 ) * personLook; float lkI = 1.0 - K_LOOK_CAVITY.x * lkC;
	  reflectedLight.indirectDiffuse *= lkI; reflectedLight.indirectSpecular *= lkI; reflectedLight.directDiffuse *= 1.0 - K_LOOK_CAVITY.y * lkC; }
`;
const replaceInclude = (src: string, name: string, body: string) => src.split(`#include <${name}>`).join(body);
/** The person's vertex stage (skinning + contact) in a shader being compiled. */
export function patchPersonVertex(sh: { vertexShader: string }) {
  let v = sh.vertexShader;
  v = replaceInclude(v, "skinning_pars_vertex", SKIN_PARS); v = replaceInclude(v, "skinbase_vertex", SKIN_BASE);
  v = replaceInclude(v, "skinning_vertex", SKINNING); v = replaceInclude(v, "skinnormal_vertex", SKIN_NORMAL);
  v = replaceInclude(v, "shadowmap_vertex", SHADOW_VERTEX);
  if (!v.includes("uniform float personNormalBias")) v = v.replace("void main() {", "uniform float personNormalBias;\nvoid main() {");
  if (v.includes("#include <project_vertex>") && !v.includes("vPersonDist")) v = v.replace("void main() {", "varying float vPersonDist;\nvoid main() {").replace("#include <project_vertex>", "#include <project_vertex>\n\tvPersonDist = length( mvPosition.xyz );");
  if (v.includes("#include <begin_vertex>") && !v.includes("vPersonCav")) v = v.replace("void main() {", "attribute float _cavity; varying float vPersonCav;\nvoid main() {").replace("#include <begin_vertex>", "#include <begin_vertex>\n\tvPersonCav = _cavity;");
  sh.vertexShader = v;
}
/** The person's shadow filter in a fragment shader being compiled. */
export function patchPersonFragment(sh: { fragmentShader: string }) {
  let f = replaceInclude(replaceInclude(sh.fragmentShader, "shadowmap_pars_fragment", SHADOW_PARS), "lights_fragment_begin", LIGHTS_BEGIN);
  if (f.includes("#include <clipping_planes_fragment>") && !f.includes("vPersonDist"))
    f = f.replace("void main() {", "uniform float personNear; varying float vPersonDist;\nvoid main() {").replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>\n\tif ( vPersonDist < personNear ) discard;");
  if (f.includes("#include <lights_fragment_maps>") && f.includes("#include <aomap_fragment>") && !f.includes("personKey"))
    f = f.replace("void main() {", LOOK_DEFINES + "uniform vec3 personKey; uniform float personLook; varying float vPersonCav;\nvoid main() {")
      .replace("#include <lights_fragment_maps>", PERSON_KEY + "#include <lights_fragment_maps>").replace("#include <aomap_fragment>", "#include <aomap_fragment>" + PERSON_OCCLUSION);
  sh.fragmentShader = f;
}
/** Install the person's shader changes on one of its materials, after whatever recipe the material already has. */
export function personShader<M extends THREE.Material>(m: M, U: PersonUniforms, tag = ""): M {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = function (this: THREE.Material, sh: THREE.WebGLProgramParametersWithUniforms, r: THREE.WebGLRenderer) {
    prev.call(this, sh, r);
    Object.assign(sh.uniforms, U);
    patchPersonVertex(sh); patchPersonFragment(sh);
  };
  m.customProgramCacheKey = () => prevKey() + "|person-v1" + tag;
  m.needsUpdate = true;
  return m;
}
/** The shadow-map material of one person mesh: three's depth material with the person's vertex stage (the cut of a garment
 *  is copied onto it by three each frame from the drawn material). */
export function personDepthMaterial(U: PersonUniforms): THREE.MeshDepthMaterial {
  return personShader(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), U, "-depth");
}
/** The sink pass (contact.ts) draws the meshes with the flatten off: the vertex stage with LAB_SINKPASS. */
export const SINK_VERTEX = /* glsl */ `#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
uniform vec3 uP, uN, uF, uS; uniform float uProfile, uSlab; uniform vec4 uBox, uMask; uniform vec2 uMaskX; varying float vV, vW, vM, vU;
void main() {
#include <begin_vertex>
#include <morphtarget_vertex>
#include <skinbase_vertex>
#include <skinning_vertex>
	vec3 rel = transformed - uP; float v = dot( rel, uN ), w = dot( rel, uF ), u = dot( rel, uS );
	v -= uProfile * labProfile( w );                                                                 // the real cushion's top, on the seat's map only (MV-core)
	if ( uSlab > 0.5 ) v -= labSlabAt( int( uSlab + 0.5 ), w ).x;                                // a shell's map: height over its face (MV-core)
	vU = u;
	vM = smoothstep( uMask.x + uMask.z * uMask.y, uMask.x + uMask.w * uMask.y, labRest.y ) * ( 1.0 - smoothstep( uMaskX.x, uMaskX.y, abs( labRest.x ) ) );
	vV = v; vW = w;
	gl_Position = vec4( ( u - uBox.x ) / ( uBox.y - uBox.x ) * 2.0 - 1.0, ( w - uBox.z ) / ( uBox.w - uBox.z ) * 2.0 - 1.0, clamp( v * 4.0, -1.0, 1.0 ), 1.0 );
}`;
export const SINK_FRAGMENT = CONTACT_DEFINES + SHELL_SD + /* glsl */ `varying float vV, vW, vM, vU; uniform float uR, uSlab; uniform highp sampler2D labContact;
void main() {
	if ( vM < 0.5 || vV < - K_C_SINK_RANGE.x || vV > K_C_SINK_RANGE.y ) discard;
	if ( uSlab > 0.5 ) {                                                                              // a shell's map: only what lies in front of or inside its face
		int r = int( uSlab + 0.5 ); vec4 h = texelFetch( labContact, ivec2( 4, r ), 0 ); float t = clamp( ( vW - h.y ) / max( h.z, 1e-6 ), 0.0, h.x - 1.0 ); int i = clamp( int( t ), 0, int( h.x + 0.5 ) - 2 );
		vec3 sa = mix( texelFetch( labContact, ivec2( 8 + i, r ), 0 ).xyz, texelFetch( labContact, ivec2( 9 + i, r ), 0 ).xyz, t - float( i ) );
		float E = texelFetch( labContact, ivec2( 0, r ), 0 ).w, R = min( E, 0.5 * max( sa.z - sa.y, 0.0 ) );          // where the push is whole (labSlab)
		if ( vU > sa.z - R || vW < h.y + E || vW > h.y + h.z * ( h.x - 1.0 ) - E || vV < - K_C_SLAB_DEPTH ) discard;
		gl_FragColor = vec4( max( - labShellSd( vV, vU, sa.y, sa.z, R ).x, 0.0 ), 1.0, 0.0, 1.0 ); return;     // how deep inside the shell
	}
	float top = uR > 0.0 && vW > - uR ? - ( uR - sqrt( max( uR * uR - ( vW + uR ) * ( vW + uR ), 0.0 ) ) ) : 0.0;     // the round-off of the seat's front edge
	gl_FragColor = vec4( max( top - vV, 0.0 ), 1.0, 0.0, 1.0 );
}`;
export { SHADES };
