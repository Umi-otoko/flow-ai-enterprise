export class SemanticNamer {
  static toSlug(text: string, maxLength = 45): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .substring(0, maxLength)
      .replace(/^_|_$/g, '');
  }

  /**
   * Builds a semantic download path.
   * Example: Flow_Generations/MyCampaign/Scene_01_stressed_stickman_office/img_01.png
   */
  static buildFilename(
    projectName: string,
    sceneNumber: number,
    prompt: string,
    imageIndex: number,
  ): string {
    const paddedScene = String(sceneNumber).padStart(2, '0');
    const slug = SemanticNamer.toSlug(prompt, 45);
    const paddedImg = String(imageIndex).padStart(2, '0');
    const safeProject = SemanticNamer.toSlug(projectName, 30) || 'project';
    return `Flow_Generations/${safeProject}/Scene_${paddedScene}_${slug}/img_${paddedImg}.png`;
  }
}
