import { createContext, useContext } from "react";
import { REST_ROUTES } from "../routes.js";

// Where a picture from elsewhere is read (ADR-0048): through the console, which fetches it and
// keeps it a while, so that the person's browser reaches nobody's server and the pages load
// nothing from elsewhere. The composition provides the client's way to it; a component outside
// one reads it at the API's own path, which a console served beside its API answers.

/** The address a picture from elsewhere is read at, given the https URL that names it. */
export type RemotePictureSrc = (url: string) => string;

export const defaultRemotePictureSrc: RemotePictureSrc = (url) =>
  `${REST_ROUTES.pictures}?src=${encodeURIComponent(url)}`;

export const RemotePicturesContext = createContext<RemotePictureSrc>(defaultRemotePictureSrc);

export function useRemotePictureSrc(): RemotePictureSrc {
  return useContext(RemotePicturesContext);
}
