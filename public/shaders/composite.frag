// Compositing vertex shader. Nothing special.

uniform mediump vec2 uScreenSize;
uniform sampler2D uPostTex;
varying mediump vec2 vTexCoord;
uniform float uDegauss;

// BEGIN DEGAUSS CODE -------------------------------------------------------------
// Realistic CRT degauss effect implementation
// Simulates the magnetic field realignment process with:
// - Horizontal sine wave distortion that settles over time
// - Color channel separation (chromatic aberration)
// - Stronger effect at screen edges
// - Oscillating wobble that dampens

// Degauss effect constants
#define DEGAUSS_DURATION 1.8       // Duration in seconds
#define DEGAUSS_INTENSITY 2.0      // Overall effect intensity (0.0-1.0)
#define DEGAUSS_RGB_MODE 0         // 1 for RGB separation, 0 for monochrome

void degauss(out vec4 fragColor, in vec2 fragCoord) {
  vec2 iResolution = uScreenSize;
  vec2 uv = vTexCoord;

  // Time parameter (0-DEGAUSS_DURATION seconds, then effect is done)
  float time = uDegauss;
  float effectDuration = DEGAUSS_DURATION;

  if (time > effectDuration) {
    // Effect is done, return normal color
    fragColor = texture2D(uPostTex, uv);
    return;
  }

  // Calculate effect strength (1.0 at start, 0.0 at end)
  float effectStrength = 1.0 - (time / effectDuration);
  effectStrength = effectStrength * effectStrength; // Quadratic falloff
  effectStrength *= DEGAUSS_INTENSITY; // Apply intensity modifier

  // Create oscillating damped sine wave for more realistic settling
  float oscillations = 8.0 - (time * 3.0); // Decrease frequency over time
  float dampedSine = sin(time * oscillations * 3.14159) * effectStrength;

  // Distance from center (normalized 0-1)
  vec2 centerDist = abs(uv - 0.5) * 2.0;
  float edgeFactor = max(centerDist.x, centerDist.y);
  edgeFactor = edgeFactor * edgeFactor; // Stronger at edges

  // Horizontal wave distortion (main degauss effect)
  float waveFreq = 4.0; // Number of waves across the screen
  float wavePhase = time * 2.0; // Wave movement speed
  float horizontalWave = sin((uv.y * waveFreq + wavePhase) * 3.14159 * 2.0);

  // Combine oscillation with horizontal wave
  float distortionAmount = horizontalWave * dampedSine * edgeFactor * 0.1;

  // Apply distortion primarily on X axis (horizontal stretching)
  vec2 distortedUV = uv;
  distortedUV.x += distortionAmount;

  // Add subtle vertical component for more organic movement
  distortedUV.y += sin(uv.x * 8.0 + time * 4.0) * dampedSine * 0.02;

  #if DEGAUSS_RGB_MODE
    // RGB mode - Chromatic aberration with separate RGB channels
    float chromaStrength = effectStrength * edgeFactor * 0.01;

    // Sample each color channel with slightly different offsets
    vec2 redOffset = vec2(chromaStrength, 0.0);
    vec2 greenOffset = vec2(0.0, 0.0);
    vec2 blueOffset = vec2(-chromaStrength, 0.0);

    // Add some rotation to the chromatic aberration based on position
    float chromaAngle = atan(uv.y - 0.5, uv.x - 0.5);
    mat2 chromaRot = mat2(cos(chromaAngle), -sin(chromaAngle),
                          sin(chromaAngle), cos(chromaAngle));

    redOffset = chromaRot * redOffset;
    blueOffset = chromaRot * blueOffset;

    // Sample the texture with chromatic aberration
    float r = texture2D(uPostTex, distortedUV + redOffset).r;
    float g = texture2D(uPostTex, distortedUV + greenOffset).g;
    float b = texture2D(uPostTex, distortedUV + blueOffset).b;
    float a = texture2D(uPostTex, distortedUV).a;

    // Add color shift/wash effect (rainbow-like color distortion)
    float colorShift = sin(time * 6.0) * effectStrength * 0.1;
    r += colorShift * sin(uv.x * 10.0 + time * 5.0);
    g += colorShift * sin(uv.x * 10.0 + time * 5.0 + 2.094);
    b += colorShift * sin(uv.x * 10.0 + time * 5.0 + 4.189);

    fragColor = vec4(r, g, b, a);
  #else
    // Monochrome mode - just distortion, no color separation
    vec4 color = texture2D(uPostTex, distortedUV);

    // Add subtle brightness pulsing
    float brightnessPulse = 1.0 + sin(time * 6.0) * effectStrength * 0.1;
    color.rgb *= brightnessPulse;

    fragColor = color;
  #endif
}

// END DEGAUSS CODE -------------------------------------------------------------

void main() {
  // Trim to the screen size. So I really should be rendering the terminal to
  // the entire texture size and doing this using the post-processing position
  // buffer, but I'm low on time. Sorry!
  if (vTexCoord.x < 0.11) discard;
  if (vTexCoord.x > 0.99) discard;
  if (vTexCoord.y < vTexCoord.x * 0.06 + 0.15) discard;
  if (vTexCoord.y > 0.84) discard;

  gl_FragColor = texture2D(uPostTex, vTexCoord);

  // The fancy CRT shader works against a black background and the alpha channel
  // is lost. Using the red value as alpha looks good enough.
  gl_FragColor.a = gl_FragColor.r;

  // Add the degauss effect
  degauss(gl_FragColor, gl_FragCoord.xy);

  // Uncomment to show a white border, which helps with positioning:
  // if (vTexCoord.x < 0.005 || vTexCoord.x > 0.995 || vTexCoord.y < 0.005 || vTexCoord.y > 0.995) gl_FragColor += 0.5;
}
