/** @format */

import React from 'react';
import {
  Animated,
  Image,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BackIcon } from '../../../assets/icons';
import { getAvatarTextColor } from '../../../helpers/getAvatarColor';

/** Height of the expanded photo hero. */
export const HERO_HEIGHT = 320;
/** Back / "…" row, directly below the status-bar inset. */
export const TOP_BAR_BUTTONS = 48;
/** Avatar + name row underneath it, revealed as the header collapses. */
export const TOP_BAR_NAME = 64;
/** Content band of the collapsed bar, below the status-bar inset. */
export const TOP_BAR_BAND = TOP_BAR_BUTTONS + TOP_BAR_NAME;
/** How far above the fully-collapsed point the bar starts fading in. */
const COLLAPSE_RAMP = 48;
/**
 * Blur strength once the header is fully collapsed. The design's collapsed
 * bar is frosted heavily — the picture is a mood, not a subject — so this
 * sits near the top of expo-blur's 0-100 range, with a dim over it to keep
 * the white text and the sharp round avatar reading against it.
 */
const BLUR_INTENSITY = 92;
/** Darkening applied on top of the blur (and used alone without it). */
const FROST_DIM = 'rgba(0,0,0,0.28)';
/** Height of the readability gradient under the name and buttons. */
const SCRIM_HEIGHT = 220;
/** Bands the gradient is built from — enough that no step is visible. */
const SCRIM_BANDS = 16;
/** Darkest the gradient gets, at the very bottom of the hero. */
const SCRIM_MAX_ALPHA = 0.45;

/**
 * How far above the hero its backdrop reaches. Over-scrolling downwards
 * exposes that band, and the picture grows into it (anchored at its own
 * bottom edge) rather than a second copy being painted there.
 */
const OVERSCROLL_REACH = 400;

// expo-blur is an OPTIONAL peer. Having the JS package is not enough — the
// native view has to be in the binary too, and an app that installed the
// package without rebuilding renders a red "Unimplemented component:
// ExpoBlurView" box instead of a blur. `requireNativeModule` throws when
// that native half is missing, which is the only reliable way to tell the
// two apart, so probe it once and fall back to a plain dim otherwise.
let BlurView: any = null;
try {
  const { requireNativeModule } = require('expo-modules-core');
  requireNativeModule('ExpoBlur');
  BlurView = require('expo-blur').BlurView ?? null;
} catch {
  BlurView = null;
}

/** True when the frosted-glass layer is the real thing, not the dim. */
export const hasNativeBlur = () => !!BlurView;

/**
 * Bottom-up darkening so white text stays readable over a photo.
 *
 * A single flat overlay (what this was) has a hard top edge that reads as
 * "the bottom half of the picture is dark". There is no gradient
 * dependency in this package, so it is stacked out of thin bands whose
 * alpha ramps quadratically — at 16 bands over 220 pt the steps are below
 * what the eye picks up on a photo.
 */
const ScrimGradient: React.FC = () => (
  <View pointerEvents="none" style={styles.scrim}>
    {Array.from({ length: SCRIM_BANDS }, (_, i) => (
      <View
        key={i}
        style={{
          height: SCRIM_HEIGHT / SCRIM_BANDS,
          backgroundColor: `rgba(0,0,0,${(
            SCRIM_MAX_ALPHA * ((i + 1) / SCRIM_BANDS) ** 2
          ).toFixed(3)})`,
        }}
      />
    ))}
  </View>
);

const FrostLayer: React.FC<{ tint?: 'dark' | 'light' }> = ({ tint = 'dark' }) =>
  BlurView ? (
    <>
      <BlurView
        intensity={BLUR_INTENSITY}
        tint={tint}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, styles.frostDim]} />
    </>
  ) : (
    <View style={[StyleSheet.absoluteFill, styles.frostFallback]} />
  );

export interface HeroAction {
  key: string;
  label: string;
  /** Rendered inside a circle tinted for the current background. */
  icon: (color: string) => React.ReactNode;
  onPress: () => void;
}

interface CommonProps {
  title: string;
  subtitle?: string;
  imageUri?: string | null;
  /** Background when the chat has no picture — one flat colour, no scrims. */
  fallbackColor: string;
  /** Two uppercase letters shown on that background. */
  initials: string;
  scrollY: Animated.Value;
  /** Prefixes every testID, so each screen's tests address their own. */
  testIDPrefix?: string;
}

/** Everything the screen needs to line its scroll content up with the bar. */
export const useHeaderMetrics = () => {
  const insets = useSafeAreaInsets();
  const barHeight = insets.top + TOP_BAR_BAND;
  return {
    insets,
    barHeight,
    /** Scroll distance between the expanded hero and the collapsed bar. */
    collapseDistance: Math.max(HERO_HEIGHT - barHeight, 1),
  };
};

const useCollapse = (scrollY: Animated.Value, collapseDistance: number) =>
  scrollY.interpolate({
    inputRange: [
      Math.max(collapseDistance - COLLAPSE_RAMP, 0),
      collapseDistance,
    ],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

/**
 * The chat picture, blown up to a full-bleed hero with the name, member
 * count and the round action buttons on top of it.
 *
 * It lives INSIDE the ScrollView (rather than behind it) so the action
 * buttons stay tappable — an absolutely-positioned hero would sit under a
 * full-screen scroll surface that swallows every touch. Parallax is done
 * on the inner image instead: the wrapper keeps its layout height while
 * the picture drifts at ~⅓ of the scroll speed, and over-scrolling
 * upwards scales it up the way iOS profile headers do.
 */
export const ProfileHero: React.FC<
  CommonProps & {
    actions: HeroAction[];
    /** Rendered to the right of the name (the profile's Leave button). */
    titleAccessory?: React.ReactNode;
    titleStyle?: StyleProp<TextStyle>;
    subtitleStyle?: StyleProp<TextStyle>;
  }
> = ({
  title,
  subtitle,
  imageUri,
  fallbackColor,
  initials,
  scrollY,
  actions,
  titleAccessory,
  titleStyle,
  subtitleStyle,
  testIDPrefix = 'chat-profile',
}) => {
  const { collapseDistance } = useHeaderMetrics();
  const parallax = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT],
    outputRange: [0, HERO_HEIGHT * 0.35],
    // Clamped on the left: with `extend` an over-scroll pulled the picture
    // UP off its own bottom edge, exposing a band of the backdrop colour
    // under it. Pulling down is the scale's job alone.
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const scale = scrollY.interpolate({
    inputRange: [-HERO_HEIGHT, 0],
    outputRange: [2, 1],
    extrapolateRight: 'clamp',
  });
  // The name and buttons are gone well before the collapsed bar arrives,
  // so the two never overlap mid-scroll.
  const contentOpacity = scrollY.interpolate({
    inputRange: [0, HERO_HEIGHT * 0.4],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const collapsed = useCollapse(scrollY, collapseDistance);

  // On a photo everything is white over a bottom scrim. On the flat
  // fallback colour there is no scrim at all — that double-tone banding
  // was two stacked scrims showing their seam — so the text takes
  // whichever of black/white reads on that colour.
  const onPhoto = !!imageUri;
  const contentColor = onPhoto ? '#FFFFFF' : getAvatarTextColor(fallbackColor);
  const circleTint =
    onPhoto || contentColor === '#FFFFFF'
      ? 'rgba(255,255,255,0.22)'
      : 'rgba(0,0,0,0.10)';

  return (
    <View style={[styles.hero, { backgroundColor: fallbackColor }]}>
      <View style={[styles.backdropClip, { backgroundColor: fallbackColor }]}>
        <Animated.View
          style={[
            styles.backdrop,
            {
              transform: [
                { translateY: parallax },
                // Scale about the bottom edge (translate → scale →
                // translate back, RN has no transform-origin) so pulling
                // down grows the picture upwards into the exposed band by
                // exactly the amount that band opened.
                { translateY: HERO_HEIGHT / 2 },
                { scale },
                { translateY: -HERO_HEIGHT / 2 },
              ],
            },
          ]}
        >
          {onPhoto ? (
            <Image
              testID={`${testIDPrefix}-hero-image`}
              source={{ uri: imageUri as string }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.initialsWrap}>
              <Text
                testID={`${testIDPrefix}-hero-initials`}
                style={[styles.heroInitials, { color: contentColor }]}
              >
                {initials}
              </Text>
            </View>
          )}
        </Animated.View>

        {/* Frosts the picture as the header collapses — the same layer the
          * collapsed bar sits on, so the transition reads as one motion.
          * Only over a photo: there is nothing to blur on a flat colour,
          * and the dim fallback would just darken it into a second shade
          * of itself. */}
        {onPhoto && (
          <Animated.View
            testID={`${testIDPrefix}-hero-blur`}
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { opacity: collapsed }]}
          >
            <FrostLayer />
          </Animated.View>
        )}

        {onPhoto && <ScrimGradient />}
      </View>

      <Animated.View style={[styles.heroContent, { opacity: contentOpacity }]}>
        <View style={styles.titleRow}>
          <Text
            numberOfLines={2}
            style={[
              styles.heroTitle,
              styles.titleText,
              { color: contentColor },
              titleStyle,
            ]}
          >
            {title}
          </Text>
          {titleAccessory}
        </View>
        {!!subtitle && (
          <Text
            style={[
              styles.heroSubtitle,
              { color: contentColor, opacity: 0.85 },
              subtitleStyle,
            ]}
          >
            {subtitle}
          </Text>
        )}
        {actions.length > 0 && (
          <View style={styles.actionsRow}>
            {actions.map((action) => (
              <TouchableOpacity
                key={action.key}
                testID={`${testIDPrefix}-action-${action.key}`}
                activeOpacity={0.7}
                style={styles.action}
                onPress={action.onPress}
              >
                <View
                  style={[styles.actionCircle, { backgroundColor: circleTint }]}
                >
                  {action.icon(contentColor)}
                </View>
                <Text style={[styles.actionLabel, { color: contentColor }]}>
                  {action.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </Animated.View>
    </View>
  );
};

/**
 * The bar pinned over the hero: back button and the "…" menu are always
 * there, while the frosted picture, small avatar and name fade in as the
 * hero scrolls away — the collapsed state from the design's third screen.
 */
export const ProfileTopBar: React.FC<
  CommonProps & {
    onBack: () => void;
    menu?: React.ReactNode;
    titleStyle?: StyleProp<TextStyle>;
  }
> = ({
  title,
  subtitle,
  imageUri,
  fallbackColor,
  initials,
  scrollY,
  onBack,
  menu,
  titleStyle,
  testIDPrefix = 'chat-profile',
}) => {
  const { insets, barHeight, collapseDistance } = useHeaderMetrics();
  const collapsed = useCollapse(scrollY, collapseDistance);
  const rise = collapsed.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });
  const onPhoto = !!imageUri;
  const contentColor = onPhoto ? '#FFFFFF' : getAvatarTextColor(fallbackColor);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.topBar, { height: barHeight, paddingTop: insets.top }]}
    >
      {/* Background layer: the same picture, cropped to the bar and frosted,
        * so nothing flips colour mid-scroll. */}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: fallbackColor, opacity: collapsed },
        ]}
      >
        {onPhoto && (
          <>
            <Image
              source={{ uri: imageUri as string }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
            <FrostLayer />
          </>
        )}
      </Animated.View>

      <View style={styles.topBarButtons}>
        <TouchableOpacity
          testID={`${testIDPrefix}-back`}
          activeOpacity={0.7}
          onPress={onBack}
          style={styles.roundButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <BackIcon color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.topBarRight}>{menu}</View>
      </View>

      {/* Avatar + name on their own row, as in the design's collapsed
        * screen. It only appears once the hero has scrolled away, so it
        * never competes with the big title over the picture. */}
      <Animated.View
        testID={`${testIDPrefix}-collapsed-title`}
        pointerEvents="none"
        style={[
          styles.collapsedTitle,
          { opacity: collapsed, transform: [{ translateY: rise }] },
        ]}
      >
        <View style={styles.collapsedAvatar}>
          {onPhoto ? (
            <Image
              source={{ uri: imageUri as string }}
              style={styles.collapsedAvatarImage}
            />
          ) : (
            <View
              style={[
                styles.collapsedAvatarImage,
                styles.initialsWrap,
                { backgroundColor: fallbackColor },
              ]}
            >
              <Text style={[styles.collapsedInitials, { color: contentColor }]}>
                {initials}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.collapsedText}>
          <Text numberOfLines={1} style={[styles.collapsedName, titleStyle]}>
            {title}
          </Text>
          {!!subtitle && (
            <Text numberOfLines={1} style={styles.collapsedSubtitle}>
              {subtitle}
            </Text>
          )}
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  hero: {
    width: '100%',
    height: HERO_HEIGHT,
    justifyContent: 'flex-end',
  },
  // Reaches above the hero and clips its own contents, so the picture can
  // grow up into the over-scroll band without spilling over the cards
  // below when it parallaxes down.
  backdropClip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT + OVERSCROLL_REACH,
    overflow: 'hidden',
  },
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: HERO_HEIGHT,
  },
  initialsWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroInitials: {
    fontSize: 64,
    fontWeight: '600',
    // Sit in the upper half so the name below never collides with it.
    marginBottom: 120,
  },
  frostDim: {
    backgroundColor: FROST_DIM,
  },
  frostFallback: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  // Only over a photo: keeps white text readable without tinting the flat
  // fallback colour.
  scrim: {
    ...StyleSheet.absoluteFill,
    top: undefined,
    height: SCRIM_HEIGHT,
    justifyContent: 'flex-end',
  },
  heroContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  // The accessory (the profile's Leave button) is pushed to the far right;
  // the name takes what is left of the row.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleText: {
    flexShrink: 1,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '600',
  },
  heroSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  // Centred: Search / Leave / Report.
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 20,
    gap: 16,
  },
  action: {
    alignItems: 'center',
    width: 64,
  },
  actionCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: {
    fontSize: 12,
    marginTop: 6,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  topBarButtons: {
    height: TOP_BAR_BUTTONS,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarRight: {
    marginLeft: 'auto',
  },
  collapsedTitle: {
    height: TOP_BAR_NAME,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 12,
  },
  collapsedAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  collapsedAvatarImage: {
    width: '100%',
    height: '100%',
  },
  collapsedInitials: {
    fontSize: 18,
    fontWeight: '600',
  },
  collapsedText: {
    flex: 1,
  },
  collapsedName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '600',
  },
  collapsedSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    marginTop: 1,
  },
});
