import React from 'react';
import { View } from 'react-native';

const MockSvg = React.forwardRef((props, ref) => <View ref={ref} {...props} />);

export const Svg = MockSvg;
export const Path = MockSvg;
export const Circle = MockSvg;
export const Rect = MockSvg;
export const Line = MockSvg;
export const Polygon = MockSvg;
export const Polyline = MockSvg;
export const G = MockSvg;
export const Text = MockSvg;
export const TSpan = MockSvg;
export const Defs = MockSvg;
export const LinearGradient = MockSvg;
export const RadialGradient = MockSvg;
export const Stop = MockSvg;
export const ClipPath = MockSvg;
export const Pattern = MockSvg;
export const Mask = MockSvg;
export const Marker = MockSvg;
export const Image = MockSvg;
export const Use = MockSvg;
export const Symbol = MockSvg;
export const SvgUri = MockSvg;
export const SvgXml = MockSvg;
export const SvgFromUri = MockSvg;
export const SvgFromXml = MockSvg;
export const parse = () => null;

export default MockSvg;
