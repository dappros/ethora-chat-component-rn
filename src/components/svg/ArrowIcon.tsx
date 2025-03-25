import React from 'react';
import Svg, {Path, SvgProps} from 'react-native-svg';

interface IconType extends SvgProps {
  currentColor: string;
  width: number;
  height: number;
  fill: string;
}

type ArrowIconType = Partial<IconType>;

const ArrowIcon: React.FC<ArrowIconType> = props => {
  const {
    currentColor,
    fill = 'none',
    width = 19,
    height = 20,
    ...svgProps
  } = props;
  return (
    <Svg
      width={width}
      height={height}
      viewBox="0 0 19 18"
      fill={fill}
      {...svgProps}>
      <Path
        d="M2.5 9L1.14147 13.8907C0.687866 15.5237 2.34371 16.9453 3.88924 16.2498L15.947 10.8238C17.5194 10.1163 17.5194 7.88372 15.947 7.17616L3.88923 1.75016C2.34371 1.05467 0.687866 2.47632 1.14147 4.10929L2.5 9ZM2.5 9H6.875"
        stroke={currentColor}
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </Svg>
  );
};

export default ArrowIcon;
