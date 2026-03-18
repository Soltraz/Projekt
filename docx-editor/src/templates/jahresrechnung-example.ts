// src/templates/jahresrechnung-example.ts

export const EXAMPLE_JAHRESRECHNUNG_HTML = /* html */ `
<p>
  <strong><mark>{CompanyName}</mark></strong><br/>
  <mark>{Adresse}</mark><br/>
  <mark>{PLZ}</mark> <mark>{ORT}</mark>
</p>

<h1>Jahresrechnung <mark>{currentYear}</mark></h1>
<p>Vom 1. Januar bis 31. Dezember <mark>{currentYear}</mark></p>

<p>Kürzel: _____________________</p>


<h2>Inhaltsverzeichnis</h2>
<ol>
  <li>Protokoll der ordentlichen Versammlung / Gewinnverwendung</li>
  <li>Anhang zur Jahresrechnung</li>
  <li>Vollständigkeitserklärung</li>
</ol>

<h3>ergänzend zu dieser Dokumentation</h3>
<ul>
  <li>Bilanz und Erfolgsrechnung vom 1. Januar bis 31. Dezember</li>
  <li>Stammanteilbewertung</li>
  <li>Gewinn- und Verlusttabelle</li>
</ul>



<h2>Protokoll der ordentlichen Gesellschafterversammlung der <mark>{CompanyName}</mark>, <mark>{ORT}</mark></h2>

<p>
  Am heutigen Tag fand in den oben genannten Räumlichkeiten eine Generalversammlung der Gesellschaft statt.
  Über die gefassten Beschlüsse, gestützt auf die Bestimmungen der Statuten und des schweizerischen
  Obligationenrechts (OR), wird nachfolgend Protokoll geführt.
</p>

<h3>Tagesordnungspunkte / Traktanden</h3>
<ol>
  <li>Begrüssung / Konstituierung / Feststellung der vertretenen Stammanteilen / Genehmigung Traktandenliste</li>
  <li>Protokoll der Generalversammlung des Vorjahrs</li>
  <li>Verzicht auf Anwesenheit einer Revisionsstelle</li>
  <li>Genehmigung aktueller Geschäftsbericht / Jahresbericht</li>
  <li>Genehmigung Jahresrechnung</li>
  <li>Beschlussfassung über die Verwendung des Bilanzgewinnes/-verlustes</li>
  <li>Entlastung der Geschäftsführung</li>
  <li>Wahlen</li>
  <li>Verschiedenes</li>
</ol>

<h3>1. Begrüssung / Konstituierung / Feststellung der vertretenen Stammanteilen / Genehmigung Traktandenliste</h3>

<p>
  Herr <mark>{gesellschafter}</mark>, <mark>{gesellschafterHerkunft}</mark>, Geschäftsführer,
  eröffnet die Versammlung und übernimmt den Vorsitz. Als Protokollführer und Stimmenzähler
  amtet Stefano Marzo.
</p>

<p>Die Vorsitzende stellt fest:</p>
<ul>
  <li>
    Es sind weder Organvertreter noch andere abhängige Stimmrechtsvertreter im Sinne von OR 689c
    vorgeschlagen, noch üben Depotvertreter im Sinne von OR 689d Mitwirkungsrechte aus;
  </li>
  <li>
    das gesamte Stammkapital der Gesellschaft von CHF <mark>{Stammkapital}</mark>, eingeteilt in
    <mark>{StammanteilBeschreibung}</mark>, ist vertreten;
  </li>
  <li>
    die heutige Generalversammlung ist als Universalversammlung im Sinne von OR 701 konstituiert
    und beschlussfähig.
  </li>
</ul>

<p>
  Gegen diese Feststellungen wird kein Widerspruch erhoben, und die Traktandenliste wird durch
  die Gesellschafterversammlung diskussionslos und einstimmig genehmigt.
</p>

<h3>2. Genehmigung Protokoll der Generalversammlung des Vorjahrs</h3>
<p>
  Das Protokoll der letzten Generalversammlung ist allen Gesellschaftern bekannt und wird
  einstimmig genehmigt und verdankt.
</p>

<h3>3. Verzicht auf Anwesenheit einer Revisionsstelle</h3>
<p>
  Die Gesellschaft bedarf weder nach den Statuten noch nach Gesetz einer Revisionsstelle.
  Die Gesellschafterversammlung nimmt diesen Verzicht zustimmend zur Kenntnis.
</p>

<h3>4. Genehmigung Geschäftsbericht / Jahresbericht (OR 725a)</h3>
<p>
  Bezüglich Vermögenslage und Jahresabschluss wird auf die Bilanz sowie auf die Erfolgs- bzw.
  Gewinn- und Verlustrechnung per 31.12. verwiesen. Die im Berichtsjahr ausgeübten Tätigkeiten
  der Gesellschaft werden von der Gesellschafterversammlung ohne Gegenstimme genehmigt.
</p>

<h3>5. Genehmigung Jahresrechnung <mark>{currentYear}</mark></h3>
<p>
  Die Bilanz per 31.12. <mark>{currentYear}</mark> (vor Jahresgewinnverwendung) mit Aktiven und
  Passiven von CHF <mark>{totaleAktiven}</mark>, einem Stammkapital von CHF <mark>{Stammkapital}</mark>,
  gesetzlichen Gewinnreserven von CHF <mark>{gesetzlicheReserven}</mark>, einem Bilanzgewinnvortrag
  von CHF <mark>{Gewinnvortrag}</mark> und einem Jahresgewinn von CHF <mark>{Gewinn}</mark>
  wird von der Gesellschafterversammlung diskussionslos und einstimmig genehmigt.
</p>

<h3>6. Gewinn-/Verlustvortrag</h3>
<p>Auf Antrag der Geschäftsführung beschliesst die Versammlung einstimmig folgenden Vortrag:</p>

<table>
  <tbody>
    <tr>
      <td>Vortrag des Bilanzerfolges per 01.01.</td>
      <td>CHF <mark>{Gewinnvortrag}</mark></td>
    </tr>
    <tr>
      <td>Jahresgewinn aktuelles Jahr</td>
      <td>CHF <mark>{Gewinn}</mark></td>
    </tr>
    <tr>
      <td><strong>Bilanzerfolg per 31.12.</strong></td>
      <td><strong>CHF <mark>{gewinnVerlustVortrag}</mark></strong></td>
    </tr>
    <tr>
      <td>Zuweisung der gesetzlichen Reserven</td>
      <td>CHF <mark>{gesetzlicheReserven}</mark></td>
    </tr>
  </tbody>
</table>

<h3>7. Entlastung der Geschäftsführung</h3>
<p>
  Aus der Versammlung wird beantragt, der Geschäftsführung für ihre Tätigkeit Entlastung zu erteilen.
  Der Antrag wird zum Beschluss erhoben. Die Geschäftsführung enthält sich der Stimme.
</p>

<h3>8. Wahlen</h3>
<p>
  Die Gesellschafterversammlung wählt die bisherigen Organe ohne Diskussion und einstimmig für
  eine weitere Amtsdauer.
</p>

<h3>9. Verschiedenes</h3>
<p>
  Nachdem sämtliche Traktanden behandelt sind, schliesst der Vorsitzende die Versammlung. Er stellt fest,
  dass während der gesamten Dauer sämtliche Anteile vertreten waren und dass kein Widerspruch
  gegen die Durchführung der Versammlung erhoben wurde.
</p>

<p>Kürzel: _____________________</p>

<p>Schluss der Versammlung: <mark>{schlussZeit}</mark></p>
<p><mark>{ORT}</mark>, <mark>{protokollDatum}</mark></p>

<p><br/>Der Vorsitzende: _____________________<br/>(<mark>{gesellschafter}</mark>)</p>
<p>Der Protokollführer: _____________________<br/>(Stefano Marzo)</p>



<h2>Anhang zur Jahresrechnung</h2>

<h3>Gesetzlich vorgeschriebene Angaben (Art. 959c OR)</h3>
<p>
  Die Jahresrechnung wurde in Übereinstimmung mit den Vorschriften des schweizerischen Gesetzes erstellt,
  insbesondere gemäss den Bestimmungen über die kaufmännische Buchführung und Rechnungslegung
  im Obligationenrecht (Art. 957 bis 962 OR).
</p>
<p>
  Bei der Rechnungslegung nimmt die Geschäftsführung Schätzungen und Beurteilungen vor, die Einfluss auf
  die Höhe der ausgewiesenen Vermögenswerte, Verbindlichkeiten und Eventualverbindlichkeiten im Zeitpunkt
  der Bilanzierung sowie auf Aufwand und Ertrag der Berichtsperiode haben können. Die Geschäftsführung
  nutzt die ihr zustehenden gesetzlichen Bewertungs- und Bilanzierungsspielräume nach pflichtgemässem
  Ermessen. Zum Schutz der Gesellschaft können im Rahmen des Vorsichtsprinzips Wertberichtigungen und
  Rückstellungen über das betrieblich notwendige Mass hinaus gebildet werden.
</p>
<p>
  Forderungen und Verbindlichkeiten gegenüber Schwestergesellschaften werden in der Jahresrechnung als
  solche gegenüber direkt oder indirekt Beteiligten ausgewiesen.
</p>

<h4>1.1 Forderungen aus Lieferungen und Leistungen</h4>
<p>-</p>

<h4>1.2 Vorräte und nicht fakturierte Dienstleistungen</h4>
<p>-</p>

<h4>1.3 Anlagevermögen</h4>
<p>
  Das Darlehen an den Gesellschafter wird nicht verzinst. Die Sachanlagen werden degressiv abgeschrieben.
</p>

<h4>1.4 Rückstellung Garantiearbeiten</h4>
<p>-</p>

<h3>2 Weitere vom Gesetz verlangte Angaben</h3>

<h4>2.1 Firma oder Name sowie Rechtsform und Sitz des Unternehmens</h4>
<p>
  <mark>{UID}</mark> <mark>{CompanyName}</mark>, <mark>{PLZ}</mark> <mark>{ORT}</mark>
</p>

<h4>2.2 Anzahl Mitarbeiter</h4>
<p>
  Das Unternehmen verfügt über einen Jahresdurchschnitt von nicht mehr als 10 Vollzeitstellen.
</p>

<h4>2.3 Beteiligungen</h4>
<p>
  Die Gesellschaft hält keine Beteiligungen an anderen Unternehmen.
</p>

<h4>2.4 Nicht bilanzierte Verbindlichkeiten</h4>
<p>-</p>

<h4>2.5 Verbindlichkeiten gegenüber Vorsorgeeinrichtungen</h4>
<p>
  Es besteht eine offene Verbindlichkeit von CHF <mark>{VorsorgeVerbindlichkeit}</mark> gegenüber
  Vorsorgeeinrichtungen.
</p>

<h4>2.6 Gesamtbetrag der für Verbindlichkeiten Dritter bestellten Sicherheiten</h4>
<p>
  Es bestehen keine Sicherheiten wie Bürgschaften, Garantien oder Eigentumsvorbehalte zugunsten Dritter.
</p>

<h4>2.7 Gesamtbetrag der zur Sicherung eigener Verbindlichkeiten verwendeten Aktiven</h4>
<p>
  Die Gesellschaft gewährt derzeit keine Sicherheiten zur Sicherung eigener Verbindlichkeiten oder solcher
  gegenüber Dritten. Es befinden sich keine Aktiven unter Eigentumsvorbehalt.
</p>

<h4>2.8 Eventualverbindlichkeiten</h4>
<p>
  Es bestehen keine rechtlichen oder tatsächlichen Verpflichtungen, die nicht verlässlich eingeschätzt oder
  bilanziert werden konnten.
</p>

<h4>2.9 Beteiligungsrechte und Optionen für Organe und Mitarbeiter</h4>
<p>
  Es bestehen keine Beteiligungsrechte oder Optionen für Organe oder Mitarbeitende.
</p>

<h4>2.10 Erläuterungen zu ausserordentlichen, einmaligen oder periodenfremden Positionen</h4>
<p>-</p>

<h4>2.11 Wesentliche Ereignisse nach dem Bilanzstichtag</h4>
<p>
  Nach dem Bilanzstichtag und bis zur Verabschiedung der Jahresrechnung durch die zuständigen Organe
  sind keine wesentlichen Ereignisse eingetreten, welche die Aussagefähigkeit der Jahresrechnung
  beeinträchtigen oder an dieser Stelle offengelegt werden müssten.
</p>

<p>Kürzel: _____________________</p>



<h2>Vollständigkeitserklärung der <mark>{CompanyName}</mark>, <mark>{ORT}</mark>, zuhanden der <mark>{TreuhandName}</mark> zur Jahresrechnung <mark>{currentYear}</mark></h2>

<p>
  Die vorliegende Vollständigkeitserklärung geben wir Ihnen im Zusammenhang mit der durch Sie zu
  erstellenden Jahresrechnung (Bilanz, Erfolgsrechnung und Anhang) der Gesellschaft für das am
  31. Dezember <mark>{currentYear}</mark> abgeschlossene Geschäftsjahr ab.
</p>
<p>
  Ziel dieser Vollständigkeitserklärung ist es zu bestätigen, dass die Jahresrechnung und die
  Gewinnverwendung in allen wesentlichen Punkten dem schweizerischen Gesetz und den Statuten
  entsprechen.
</p>

<p>
  Wir anerkennen die Verantwortung der Geschäftsführung für diese Jahresrechnung. Der Geschäftsführer
  hat diese Jahresrechnung zur Bekanntgabe an die Gesellschafterversammlung gutgeheissen.
</p>

<p>Wir bestätigen Ihnen hiermit nach bestem Wissen Folgendes:</p>

<ol>
  <li>
    Die Jahresrechnung entspricht dem schweizerischen Gesetz und den Statuten und ist in diesem Sinn
    frei von wesentlichen Fehlaussagen. Dazu zählen sowohl unzutreffende Erfassung, Bewertung,
    Darstellung oder Offenlegung als auch wesentliche Unterlassungen.
  </li>
  <li>
    Sämtliche relevanten Informationen, Aufzeichnungen der Buchhaltung, Belege, Geschäftskorrespondenz
    sowie die Protokolle aller Gesellschafterversammlungen und Sitzungen der Geschäftsführung
    wurden vollständig zur Verfügung gestellt. Alle Geschäftsvorfälle sind chronologisch, vollständig
    und in der erforderlichen Belegqualität dokumentiert.
  </li>
  <li>
    Die Gesellschaft hat alle vertraglichen Verpflichtungen und gesetzlichen Vorschriften (insbesondere
    in Bezug auf direkte Steuern, Mehrwertsteuer, Sozialversicherungen und Umweltschutz) eingehalten,
    deren Verletzung eine wesentliche Auswirkung auf die Jahresrechnung haben könnte.
  </li>
  <li>
    Die zur Identifikation nahestehender Personen erforderlichen Angaben wurden vollständig offengelegt.
    Guthaben und Verbindlichkeiten gegenüber Gesellschaftern und Gruppen- bzw. Konzerngesellschaften
    sind vollständig und korrekt ausgewiesen.
  </li>
  <li>
    Es bestehen keine Pläne oder uns bekannte Ereignisse, welche erhebliche Zweifel an der Fähigkeit
    der Gesellschaft zur Fortführung der Unternehmenstätigkeit (Going Concern) begründen würden.
  </li>
  <li>
    Bildung, Auflösung und Bestand allfälliger stiller Reserven wurden im Einzelnen offengelegt, soweit dies
    gesetzlich gefordert ist.
  </li>
  <li>
    Es bestehen keine Absichten oder Massnahmen, welche die Bilanzierung, Bewertung oder Darstellung
    von Vermögenswerten oder Verbindlichkeiten in der Jahresrechnung wesentlich verändern würden.
  </li>
  <li>
    Die Gesellschaft ist verfügungsberechtigte Eigentümerin sämtlicher aktivierter Vermögenswerte.
    Weitere Belastungen oder Sicherungsrechte als in der Jahresrechnung offen gelegt bestehen nicht.
  </li>
  <li>
    Sämtliche bestehenden Verbindlichkeiten sowie Eventualverbindlichkeiten (z.B. Garantien, Bürgschaften
    und vergleichbare Verpflichtungen gegenüber Dritten) sind in der Jahresrechnung ordnungsgemäss
    erfasst bzw. offengelegt.
  </li>
  <li>
    Alle wesentlichen Ereignisse nach dem Bilanzstichtag, die eine Auswirkung auf die Beurteilung der
    Jahresrechnung haben könnten, sind in der Jahresrechnung berücksichtigt bzw. offengelegt.
  </li>
  <li>
    Ansprüche aus Rechtstreitigkeiten oder anderen Auseinandersetzungen, welche für die Beurteilung der
    Jahresrechnung wesentlich sind, bestehen nicht bzw. sind in den Beilagen zur Jahresrechnung erfasst.
  </li>
  <li>
    Sämtliche Kreditvereinbarungen wurden offen gelegt. Die entsprechenden Bedingungen waren am
    Bilanzstichtag und sind zum Zeitpunkt der Unterzeichnung dieser Vollständigkeitserklärung eingehalten.
  </li>
  <li>
    Betrag und Verwendungszweck nicht frei verwendbarer Bestandteile des Eigenkapitals (insbesondere
    Reserven gemäss Art. 671 ff. OR) sind in der Jahresrechnung ordnungsgemäss erfasst bzw. offengelegt.
  </li>
</ol>

<p><mark>{ORT}</mark>, <mark>{vollstaendigkeitDatum}</mark> — <mark>{CompanyName}</mark></p>
<p>_____________________</p>

<p>Kürzel: _____________________</p>
`;
